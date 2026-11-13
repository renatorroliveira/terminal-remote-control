//! `trcd bridge`: what the app runs over its SSH exec channel. It relays stdio to the core's socket and starts a
//! detached core when none is running, so the channel works even when SSH forwarding is disabled (US-1.5.3, P-17).

use std::io;
use std::process::Stdio;
use std::time::Duration;

use tokio::io::{AsyncWriteExt, copy};
use tokio::net::UnixStream;

use crate::install::InstallLayout;
use crate::peer::is_same_user;
use crate::private_dir::verify_private_dir;
use crate::run_dir::RunDir;
use crate::socket::connect_with_retry;

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
        if let Ok(stream) = UnixStream::connect(run.core_socket()).await {
            return trusted(stream);
        }
    }
    start_core(layout)?;
    let stream = connect_with_retry(&run.core_socket(), CORE_START_TIMEOUT).await?;
    verify_private_dir(&run.dir, uid)?;
    trusted(stream)
}

fn trusted(stream: UnixStream) -> io::Result<UnixStream> {
    if is_same_user(&stream) {
        Ok(stream)
    } else {
        Err(io::Error::other("the core socket is served by another user"))
    }
}

fn start_core(layout: &InstallLayout) -> io::Result<()> {
    let status = std::process::Command::new(&layout.binary)
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
