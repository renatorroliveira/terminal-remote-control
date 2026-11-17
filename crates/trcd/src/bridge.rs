//! `trcd bridge`: what the app runs over its SSH exec channel. It relays stdio to the core's socket and starts a core
//! when none is running, so the channel works even when SSH forwarding is disabled (US-1.5.3, P-17). A bridge newer
//! than the running core replaces it first, which upgrades the daemon without ending a session (US-2.5.3, D-46).

use std::io;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use tokio::io::{AsyncWriteExt, copy};
use tokio::net::UnixStream;

use crate::core::account::current_account;
use crate::install::InstallLayout;
use crate::launchd::{agent_is_running, has_gui_session, start_agent};
use crate::peer::is_same_user;
use crate::private_dir::verify_private_dir;
use crate::run_dir::RunDir;
use crate::service::{ServiceMode, read_host_facts, start_unit, unit_is_running};
use crate::socket::connect_with_retry;
use crate::upgrade::{RunningCore, lock_upgrades, newest_core_binary, running_core, should_replace, stop_core};

/// How long the bridge waits for a core it started.
const CORE_START_TIMEOUT: Duration = Duration::from_secs(10);
/// How long the bridge keeps passing on the core's output after its input ends, so replies already on the way arrive.
const DRAIN_TIMEOUT: Duration = Duration::from_secs(5);

/// Connects to the core, starting it when needed, and relays until either side closes.
pub fn run(layout: &InstallLayout) -> io::Result<()> {
    let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build()?;
    let result = runtime.block_on(async {
        let stream = connect_or_start(layout).await?;
        relay(stream).await
    });
    runtime.shutdown_background();
    result
}

async fn connect_or_start(layout: &InstallLayout) -> io::Result<UnixStream> {
    let uid = rustix::process::geteuid().as_raw();
    let run = RunDir::for_root(&layout.root, uid);
    if run.dir.exists() {
        verify_private_dir(&run.dir, uid)?;
        replace_older_core(layout, &run);
        if let Ok(stream) = UnixStream::connect(run.core_socket()).await {
            return trusted(stream);
        }
    }
    start_core(layout)?;
    let stream = connect_with_retry(&run.core_socket(), CORE_START_TIMEOUT).await?;
    verify_private_dir(&run.dir, uid)?;
    trusted(stream)
}

/// Stops a running core older than this bridge, so the core started next is this version. One bridge at a time
/// decides, under `upgrade.lock`, from a fresh look at the running core, so two bridges never stop the core one of
/// them just started. A core that will not stop keeps serving: the app then talks to it in a protocol both speak.
fn replace_older_core(layout: &InstallLayout, run: &RunDir) {
    if older_core(run).is_none() {
        return;
    }
    let Ok(_lock) = lock_upgrades(run) else {
        return;
    };
    let Some(core) = older_core(run) else {
        return;
    };
    if let Err(error) = stop_core(&core, layout, run) {
        eprintln!("trcd: the older core was not replaced: {error}");
    }
}

fn older_core(run: &RunDir) -> Option<RunningCore> {
    running_core(run).filter(|core| should_replace(core.version.as_deref(), env!("CARGO_PKG_VERSION")))
}

fn trusted(stream: UnixStream) -> io::Result<UnixStream> {
    if is_same_user(&stream) {
        Ok(stream)
    } else {
        Err(io::Error::other("the core socket is served by another user"))
    }
}

/// Starts the core under the host's service manager where that keeps sessions longer, otherwise detached. A manager
/// that cannot start it falls back to detached, unless the manager runs the install's own core, which then serves.
fn start_core(layout: &InstallLayout) -> io::Result<()> {
    let binary = newest_core_binary(layout);
    match start_supervised(&binary, &layout.root) {
        Some(Ok(())) => return Ok(()),
        Some(Err(error)) => eprintln!("trcd: {error}; starting the core detached"),
        None => {}
    }
    start_detached(&binary)
}

/// Starts the core as a LaunchAgent where the user has a GUI login session (P-61), or as a systemd user unit where
/// D-44 asks for one; `None` where neither applies.
fn start_supervised(binary: &Path, root: &Path) -> Option<io::Result<()>> {
    let uid = rustix::process::geteuid().as_raw();
    if has_gui_session(uid) {
        let started = start_agent(binary, root, current_umask(), &home());
        return Some(started.or_else(|error| if agent_is_running(root) { Ok(()) } else { Err(error) }));
    }
    if read_host_facts(&current_account().user, uid).mode() != ServiceMode::Systemd {
        return None;
    }
    let started = start_unit(binary, root, current_umask());
    Some(started.or_else(|error| if unit_is_running(root) { Ok(()) } else { Err(error) }))
}

/// The user's home folder, where the LaunchAgent's plist goes: `HOME`, as the connection set it, else the account's.
fn home() -> PathBuf {
    std::env::var_os("HOME").map_or_else(|| PathBuf::from(current_account().home), PathBuf::from)
}

fn current_umask() -> rustix::fs::Mode {
    let mask = rustix::process::umask(rustix::fs::Mode::from_raw_mode(0o077));
    rustix::process::umask(mask);
    mask
}

fn start_detached(binary: &Path) -> io::Result<()> {
    let status = std::process::Command::new(binary)
        .args(["core", "--detach"])
        .current_dir("/")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::inherit())
        .status()?;
    if status.success() {
        Ok(())
    } else {
        Err(io::Error::other(format!("the core did not start ({status})")))
    }
}

async fn relay(stream: UnixStream) -> io::Result<()> {
    let (mut from_core, mut to_core) = stream.into_split();
    let mut stdin = tokio::io::stdin();
    let mut stdout = tokio::io::stdout();
    let upstream = async {
        copy(&mut stdin, &mut to_core).await?;
        to_core.shutdown().await
    };
    let downstream = async {
        copy(&mut from_core, &mut stdout).await?;
        stdout.flush().await
    };
    tokio::pin!(downstream);
    tokio::select! {
        result = upstream => {
            result?;
            tokio::time::timeout(DRAIN_TIMEOUT, &mut downstream).await.unwrap_or(Ok(()))
        }
        result = &mut downstream => result,
    }
}
