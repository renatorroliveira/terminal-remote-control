//! The `trcd holder` process: binds the session's private socket and serves it until the session shuts down.

use std::io;
use std::os::unix::net::UnixListener as StdUnixListener;
use std::path::Path;

use rustix::fs::Mode;
use tokio::net::UnixListener;

use super::service::Holder;

/// Serves one session on a new socket at `path`, created with mode 0600, and removes the socket on shutdown.
///
/// Fails without touching `path` when something already exists there. The shell inherits the process's umask
/// unchanged.
pub fn serve(path: &Path) -> io::Result<()> {
    let listener = bind_private(path)?;
    listener.set_nonblocking(true)?;
    let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build()?;
    runtime.block_on(async {
        Holder::new().run(UnixListener::from_std(listener)?).await;
        std::fs::remove_file(path)
    })
}

fn bind_private(path: &Path) -> io::Result<StdUnixListener> {
    let inherited = rustix::process::umask(Mode::from_raw_mode(0o177));
    let bound = StdUnixListener::bind(path);
    rustix::process::umask(inherited);
    bound
}
