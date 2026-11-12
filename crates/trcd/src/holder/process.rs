//! The `trcd holder` process: binds the session's private socket and serves it until the session shuts down.

use std::io;
use std::path::Path;

use tokio::net::UnixListener;

use super::service::Holder;
use crate::socket::bind_private;

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
        match std::fs::remove_file(path) {
            Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error),
            _ => Ok(()),
        }
    })
}
