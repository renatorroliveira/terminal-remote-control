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
use super::service::{Core, CoreContext};
use super::store::{SessionStore, boot_id};
use crate::digest::sha256_file;
use crate::install::InstallLayout;
use crate::private_dir::ensure_private_dir;
use crate::run_dir::RunDir;
use crate::service::{ScopeLauncher, read_host_facts};
use crate::socket::bind_private;
use crate::upgrade::lock_contents;

/// How long a starting core waits for the core lock, which a core exiting after Restart daemon holds for moments.
const LOCK_WAIT: Duration = Duration::from_secs(3);

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

/// Runs the core in the foreground until it is killed. Under systemd (`systemd`), holders start in their own
/// transient scopes, outside the unit's control group (US-2.5.2).
///
/// The core creates its files with umask 077; holders get back the umask the core inherited.
pub fn run(layout: &InstallLayout, systemd: bool) -> Result<(), StartError> {
    let uid = rustix::process::geteuid().as_raw();
    let login_umask = rustix::process::umask(Mode::from_raw_mode(0o077));
    let run = RunDir::for_root(&layout.root, uid);
    let sessions_dir = layout.root.join("sessions");
    for dir in [layout.logs_dir(), run.dir.clone(), run.holders(), sessions_dir.clone()] {
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
    let scope = if systemd { ScopeLauncher::find() } else { None };
    let details = DaemonDetails {
        home: account.home.clone(),
        install_root: layout.root.to_string_lossy().into_owned(),
        log_dir: layout.logs_dir().to_string_lossy().into_owned(),
        started_at: crate::time::now_millis(),
    };
    let context = CoreContext {
        binary: layout.binary.clone(),
        binary_sha256,
        run,
        account,
        holder_umask: login_umask,
        service: ServiceInfo {
            manager: if scope.is_some() {
                ServiceManager::Systemd
            } else {
                ServiceManager::Detached
            },
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
        core.serve(UnixListener::from_std(listener)?).await;
        Ok(())
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
