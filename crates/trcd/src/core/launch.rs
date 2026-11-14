//! Starting holder processes: `trcd holder --socket <path>` in a new session, with the login umask and an empty
//! environment, then connecting to its socket. The install is checked first, as the holder would refuse it with its
//! output discarded, so the reason reaches the session instead of a timeout (SEC-04.4). Under systemd the holder
//! starts in its own transient scope, outside the core unit's control group, so stopping or restarting the core
//! never ends a session (US-2.5.2); a scope that cannot start falls back to a direct start.

use std::ffi::OsString;
use std::io;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use rustix::fs::Mode;
use tokio::net::UnixStream;
use tokio::process::Child;

use crate::install::InstallLayout;
use crate::service::ScopeLauncher;
use crate::socket::connect_with_retry;

/// How long a new holder has to create its socket.
const HOLDER_START_TIMEOUT: Duration = Duration::from_secs(5);

/// Starts a holder serving `socket` and returns the connection to it. The holder runs in its own session, so it
/// outlives the core, and its shell gets `umask` (the login session's) instead of the core's private one. With a
/// `scope` launcher, the holder also runs in its own systemd scope. Fails at once, naming the path, when the install
/// around `binary` no longer passes the integrity check.
pub async fn launch_holder(
    binary: &Path,
    socket: &Path,
    umask: Mode,
    scope: Option<&ScopeLauncher>,
) -> io::Result<UnixStream> {
    check_install(binary)?;
    if let Some(launcher) = scope {
        let session = socket.file_stem().map(|stem| stem.to_string_lossy().into_owned());
        let args = launcher.arguments(session.as_deref().unwrap_or("session"), binary, socket);
        let child = spawn(&launcher.program, &args, &launcher.env, umask)?;
        match connect_or_exit(child, socket).await {
            Ok(stream) => return Ok(stream),
            Err(error) => tracing::warn!(%error, "a holder scope did not start; starting the holder directly"),
        }
    }
    let args: Vec<OsString> = vec!["holder".into(), "--socket".into(), socket.into()];
    let child = spawn(binary, &args, &[], umask)?;
    connect_or_exit(child, socket).await
}

fn spawn(program: &Path, args: &[OsString], env: &[(String, String)], umask: Mode) -> io::Result<Child> {
    let mut command = tokio::process::Command::new(program);
    command
        .args(args)
        .env_clear()
        .envs(env.iter().map(|(name, value)| (name, value)))
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
    command.spawn()
}

/// Connects to the holder's socket, unless the process exits first, which means it never will.
async fn connect_or_exit(mut child: Child, socket: &Path) -> io::Result<UnixStream> {
    tokio::select! {
        connected = connect_with_retry(socket, HOLDER_START_TIMEOUT) => {
            tokio::spawn(async move {
                let _ = child.wait().await;
            });
            connected
        }
        status = child.wait() => Err(io::Error::other(format!("the holder exited at once ({})", status?))),
    }
}

fn check_install(binary: &Path) -> io::Result<()> {
    InstallLayout::from_binary(binary)
        .and_then(|layout| layout.check_integrity(rustix::process::geteuid().as_raw()))
        .map_err(|error| io::Error::new(io::ErrorKind::PermissionDenied, error.to_string()))
}
