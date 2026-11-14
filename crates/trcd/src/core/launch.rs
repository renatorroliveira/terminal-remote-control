//! Starting holder processes: `trcd holder --socket <path>` in a new session, with the login umask and an empty
//! environment, then connecting to its socket. The install is checked first, as the holder would refuse it with its
//! output discarded, so the reason reaches the session instead of a timeout (SEC-04.4).

use std::io;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use rustix::fs::Mode;
use tokio::net::UnixStream;

use crate::install::InstallLayout;
use crate::socket::connect_with_retry;

/// How long a new holder has to create its socket.
const HOLDER_START_TIMEOUT: Duration = Duration::from_secs(5);

/// Starts a holder serving `socket` and returns the connection to it. The holder runs in its own session, so it
/// outlives the core, and its shell gets `umask` (the login session's) instead of the core's private one. Fails at
/// once, naming the path, when the install around `binary` no longer passes the integrity check.
pub async fn launch_holder(binary: &Path, socket: &Path, umask: Mode) -> io::Result<UnixStream> {
    check_install(binary)?;
    let mut command = tokio::process::Command::new(binary);
    command
        .args(["holder", "--socket"])
        .arg(socket)
        .env_clear()
        .current_dir("/")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    // SAFETY: the closure runs between fork and exec and makes only async-signal-safe system calls (`setsid`,
    // `umask`), with no allocation.
    unsafe {
        command.pre_exec(move || {
            rustix::process::setsid()?;
            rustix::process::umask(umask);
            Ok(())
        });
    }
    let mut child = command.spawn()?;
    tokio::spawn(async move {
        let _ = child.wait().await;
    });
    connect_with_retry(socket, HOLDER_START_TIMEOUT).await
}

fn check_install(binary: &Path) -> io::Result<()> {
    InstallLayout::from_binary(binary)
        .and_then(|layout| layout.check_integrity(rustix::process::geteuid().as_raw()))
        .map_err(|error| io::Error::new(io::ErrorKind::PermissionDenied, error.to_string()))
}
