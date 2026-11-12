//! Starting the core: private directories, one core per user, the socket, adoption of live holders, then serving.

use std::fs::File;
use std::io::{self, Write};
use std::os::unix::fs::OpenOptionsExt;
use std::path::Path;
use std::process::Stdio;

use rustix::fs::{FlockOperation, Mode};
use thiserror::Error;
use tokio::net::UnixListener;

use super::account::current_account;
use super::service::{Core, CoreContext};
use crate::digest::sha256_file;
use crate::install::InstallLayout;
use crate::private_dir::ensure_private_dir;
use crate::run_dir::RunDir;
use crate::socket::bind_private;

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

/// Runs the core in the foreground until it is killed.
///
/// The core creates its files with umask 077; holders get back the umask the core inherited.
pub fn run(layout: &InstallLayout) -> Result<(), StartError> {
    let uid = rustix::process::geteuid().as_raw();
    let login_umask = rustix::process::umask(Mode::from_raw_mode(0o077));
    let run = RunDir::for_root(&layout.root, uid);
    for dir in [layout.logs_dir(), run.dir.clone(), run.holders()] {
        ensure_private_dir(&dir, uid)?;
    }
    let _lock = lock_single_instance(&run.core_lock())?;
    crate::logging::init(&layout.logs_dir())?;
    remove_stale(&run.core_socket())?;
    let listener = bind_private(&run.core_socket())?;
    listener.set_nonblocking(true)?;
    let context = CoreContext {
        binary: layout.binary.clone(),
        binary_sha256: sha256_file(&layout.binary)?,
        run,
        account: current_account(),
        holder_umask: login_umask,
    };
    tracing::info!(version = env!("CARGO_PKG_VERSION"), "core started");
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

fn lock_single_instance(path: &Path) -> Result<File, StartError> {
    let mut file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .open(path)?;
    match rustix::fs::flock(&file, FlockOperation::NonBlockingLockExclusive) {
        Ok(()) => {}
        Err(rustix::io::Errno::WOULDBLOCK) => return Err(StartError::AlreadyRunning),
        Err(error) => return Err(io::Error::from(error).into()),
    }
    file.set_len(0)?;
    writeln!(file, "{}", std::process::id())?;
    Ok(file)
}

fn remove_stale(socket: &Path) -> io::Result<()> {
    match std::fs::remove_file(socket) {
        Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error),
        _ => Ok(()),
    }
}
