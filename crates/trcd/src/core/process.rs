//! Starting the core: private directories, one core per user, the socket, adoption of live holders, then serving.

use std::fs::File;
use std::io::{self, Write};
use std::os::unix::fs::OpenOptionsExt;
use std::path::Path;
use std::process::Stdio;
use std::time::{Duration, Instant};

use rustix::fs::{FlockOperation, Mode};
use thiserror::Error;
use tokio::net::UnixListener;
use trc_protocol::{DaemonDetails, ServiceInfo, ServiceManager};

use super::account::current_account;
pub use super::service::Ending;
use super::service::{Core, CoreContext};
use super::store::{SessionStore, boot_id};
use crate::command::Supervisor;
use crate::digest::sha256_file;
use crate::install::InstallLayout;
use crate::private_dir::ensure_private_dir;
use crate::run_dir::RunDir;
use crate::service::{ScopeLauncher, read_host_facts};
use crate::socket::bind_private;
use crate::upgrade::lock_contents;

/// How long a starting core waits for the core lock, which a core exiting after Restart daemon holds for moments.
const LOCK_WAIT: Duration = Duration::from_secs(5);

/// Why the core did not start.
#[derive(Debug, Error)]
pub enum StartError {
    /// Another core already serves this user.
    #[error("another core is already running")]
    AlreadyRunning,
    /// The OS refused a resource.
    #[error(transparent)]
    Io(#[from] io::Error),
}

impl StartError {
    /// Whether starting again may succeed: the OS ran short of something for a while, such as file descriptors,
    /// space or memory. Another running core, a folder others can open, a missing path or a refusal does not pass
    /// by itself, so under launchd such a core exits 0 rather than start again every second.
    pub fn may_pass(&self) -> bool {
        let Self::Io(error) = self else {
            return false;
        };
        let short_of_files = [rustix::io::Errno::MFILE, rustix::io::Errno::NFILE]
            .iter()
            .any(|errno| error.raw_os_error() == Some(errno.raw_os_error()));
        short_of_files || TRANSIENT.contains(&error.kind())
    }
}

/// The kinds of OS errors that pass by themselves.
const TRANSIENT: [io::ErrorKind; 8] = [
    io::ErrorKind::Interrupted,
    io::ErrorKind::WouldBlock,
    io::ErrorKind::TimedOut,
    io::ErrorKind::StorageFull,
    io::ErrorKind::QuotaExceeded,
    io::ErrorKind::ResourceBusy,
    io::ErrorKind::OutOfMemory,
    io::ErrorKind::AddrInUse,
];

/// Runs the core in the foreground until an app asks it to end or SIGTERM ends it, and says which. Under systemd,
/// holders start in their own transient scopes, outside the unit's control group (US-2.5.2); under launchd they
/// already run in sessions of their own (D-50).
///
/// The core creates its files with umask 077; holders get back the umask the core inherited.
pub fn run(layout: &InstallLayout, supervisor: Supervisor) -> Result<Ending, StartError> {
    let uid = rustix::process::geteuid().as_raw();
    let login_umask = rustix::process::umask(Mode::from_raw_mode(0o077));
    let run = RunDir::for_root(&layout.root, uid);
    let sessions_dir = layout.root.join("sessions");
    ensure_private_dir(&layout.logs_dir(), uid)?;
    if supervisor == Supervisor::Launchd {
        crate::launchd::trim_log(&layout.logs_dir());
    }
    for dir in [run.dir.clone(), run.holders(), sessions_dir.clone()] {
        ensure_private_dir(&dir, uid)?;
    }
    let binary_sha256 = sha256_file(&layout.binary)?;
    let _lock = lock_single_instance(&run.core_lock(), &binary_sha256)?;
    crate::logging::init(&layout.logs_dir())?;
    remove_stale(&run.core_socket())?;
    let listener = bind_private(&run.core_socket())?;
    listener.set_nonblocking(true)?;
    let account = current_account();
    let facts = read_host_facts(&account.user, uid);
    let scope = if supervisor == Supervisor::Systemd {
        ScopeLauncher::find()
    } else {
        None
    };
    let details = DaemonDetails {
        home: account.home.clone(),
        install_root: layout.root.to_string_lossy().into_owned(),
        log_dir: layout.logs_dir().to_string_lossy().into_owned(),
        started_at: crate::time::now_millis(),
        uptime_ms: None,
    };
    let context = CoreContext {
        binary: layout.binary.clone(),
        binary_sha256,
        run,
        account,
        holder_umask: login_umask,
        service: ServiceInfo {
            manager: service_manager(supervisor, scope.is_some()),
            sessions_end_at_logout: facts.sessions_end_at_logout(),
        },
        scope,
        details,
        store: SessionStore::new(sessions_dir, uid),
        boot_id: boot_id(),
    };
    tracing::info!(
        version = env!("CARGO_PKG_VERSION"),
        systemd = context.scope.is_some(),
        sessions_end_at_logout = context.service.sessions_end_at_logout,
        "core started"
    );
    let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build()?;
    runtime.block_on(async {
        let mut core = Core::new(context);
        core.adopt().await;
        Ok(core.serve(UnixListener::from_std(listener)?).await)
    })
}

/// `trcd core --detach`: starts a foreground core in a new session and returns at once, so the core is neither a
/// child of the caller nor a session leader (P-17).
pub fn launch_detached(layout: &InstallLayout) -> io::Result<()> {
    rustix::process::setsid()?;
    std::process::Command::new(&layout.binary)
        .arg("core")
        .current_dir("/")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(drop)
}

/// What runs the core, as Welcome says: systemd only when holders can start in their own scopes, as a core whose
/// holders would die with its unit serves no better than a detached one.
fn service_manager(supervisor: Supervisor, scopes: bool) -> ServiceManager {
    match supervisor {
        Supervisor::Systemd if scopes => ServiceManager::Systemd,
        Supervisor::Launchd => ServiceManager::Launchd,
        Supervisor::Systemd | Supervisor::None => ServiceManager::Detached,
    }
}

/// Takes the one-core-per-user lock and records the PID, version and checksum in it, so a newer bridge can tell
/// whether to replace this core (D-46). Waits a moment for a core that is exiting after Restart daemon to let go.
fn lock_single_instance(path: &Path, sha256: &str) -> Result<File, StartError> {
    let mut file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .open(path)?;
    let started = Instant::now();
    loop {
        match rustix::fs::flock(&file, FlockOperation::NonBlockingLockExclusive) {
            Ok(()) => break,
            Err(rustix::io::Errno::WOULDBLOCK) if started.elapsed() < LOCK_WAIT => {
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(rustix::io::Errno::WOULDBLOCK) => return Err(StartError::AlreadyRunning),
            Err(error) => return Err(io::Error::from(error).into()),
        }
    }
    file.set_len(0)?;
    file.write_all(lock_contents(std::process::id(), env!("CARGO_PKG_VERSION"), sha256).as_bytes())?;
    Ok(file)
}

fn remove_stale(socket: &Path) -> io::Result<()> {
    match std::fs::remove_file(socket) {
        Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retries_a_start_only_when_the_os_ran_short_of_something() {
        let io = |error: io::Error| StartError::Io(error);
        assert!(io(io::Error::from(io::ErrorKind::StorageFull)).may_pass());
        assert!(io(io::Error::from_raw_os_error(rustix::io::Errno::MFILE.raw_os_error())).may_pass());
        assert!(!io(io::Error::other("the run folder must be 700")).may_pass());
        assert!(!io(io::Error::from(io::ErrorKind::PermissionDenied)).may_pass());
        assert!(!io(io::Error::from(io::ErrorKind::NotADirectory)).may_pass());
        assert!(!StartError::AlreadyRunning.may_pass());
    }

    #[test]
    fn names_the_manager_that_runs_the_core() {
        assert_eq!(service_manager(Supervisor::Systemd, true), ServiceManager::Systemd);
        assert_eq!(service_manager(Supervisor::Systemd, false), ServiceManager::Detached);
        assert_eq!(service_manager(Supervisor::Launchd, false), ServiceManager::Launchd);
        assert_eq!(service_manager(Supervisor::None, false), ServiceManager::Detached);
    }
}
