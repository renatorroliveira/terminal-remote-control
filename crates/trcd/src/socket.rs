//! Private Unix sockets: bound with mode 0600, and reached with retries while their server starts (SEC-02).

use std::io;
use std::os::unix::net::UnixListener;
use std::path::Path;
use std::time::Duration;

use rustix::fs::Mode;
use tokio::net::UnixStream;
use tokio::time::{Instant, sleep};

/// How long to wait between connection attempts.
const RETRY_INTERVAL: Duration = Duration::from_millis(10);

/// Binds a new socket at `path` with mode 0600, then restores the process's umask.
pub fn bind_private(path: &Path) -> io::Result<UnixListener> {
    let inherited = rustix::process::umask(Mode::from_raw_mode(0o177));
    let bound = UnixListener::bind(path);
    rustix::process::umask(inherited);
    bound
}

/// Connects to `path`, retrying until `timeout` passes, for a server that is still starting.
pub async fn connect_with_retry(path: &Path, timeout: Duration) -> io::Result<UnixStream> {
    let deadline = Instant::now() + timeout;
    loop {
        match UnixStream::connect(path).await {
            Ok(stream) => return Ok(stream),
            Err(error) if Instant::now() >= deadline => return Err(error),
            Err(_) => sleep(RETRY_INTERVAL).await,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::PermissionsExt;

    use super::*;

    #[test]
    fn binds_with_mode_0600_and_keeps_the_umask() {
        let path = crate::test_support::temp_dir("socket").join("s.sock");
        let before = rustix::process::umask(Mode::from_raw_mode(0o022));
        let _listener = bind_private(&path).unwrap();
        let after = rustix::process::umask(before);
        assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        assert_eq!(after, Mode::from_raw_mode(0o022));
    }

    #[tokio::test]
    async fn retries_until_the_server_appears() {
        let path = crate::test_support::temp_dir("socket").join("late.sock");
        let server_path = path.clone();
        let server = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(100));
            let listener = UnixListener::bind(&server_path).unwrap();
            listener.accept().unwrap();
        });
        assert!(connect_with_retry(&path, Duration::from_secs(5)).await.is_ok());
        server.join().unwrap();
        let missing = path.with_file_name("never.sock");
        assert!(connect_with_retry(&missing, Duration::from_millis(50)).await.is_err());
    }
}
