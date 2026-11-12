//! The run directory: the core's socket and lock, and one socket per holder.

use std::path::{Path, PathBuf};

use trc_protocol::SessionId;

use crate::session_id::SESSION_ID_LEN;

/// The longest socket path the OS accepts, without the terminating NUL (`sun_path` is 104 bytes on macOS).
#[cfg(target_os = "macos")]
pub const MAX_SOCKET_PATH: usize = 103;
/// The longest socket path the OS accepts, without the terminating NUL (`sun_path` is 108 bytes on Linux).
#[cfg(not(target_os = "macos"))]
pub const MAX_SOCKET_PATH: usize = 107;

/// Where the daemon's sockets live: `<root>/run`, or `/tmp/trc-<uid>` when that path is too long for a socket.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunDir {
    /// The directory itself.
    pub dir: PathBuf,
}

impl RunDir {
    /// Picks the run directory for an install root.
    pub fn for_root(root: &Path, uid: u32) -> Self {
        let preferred = Self { dir: root.join("run") };
        let longest = preferred.holders().join(format!("{}.sock", "0".repeat(SESSION_ID_LEN)));
        if longest.as_os_str().len() <= MAX_SOCKET_PATH {
            preferred
        } else {
            Self {
                dir: PathBuf::from(format!("/tmp/trc-{uid}")),
            }
        }
    }

    /// The core's socket.
    pub fn core_socket(&self) -> PathBuf {
        self.dir.join("core.sock")
    }

    /// The lock the running core holds.
    pub fn core_lock(&self) -> PathBuf {
        self.dir.join("core.lock")
    }

    /// The directory of holder sockets.
    pub fn holders(&self) -> PathBuf {
        self.dir.join("holders")
    }

    /// One holder's socket.
    pub fn holder_socket(&self, session: &SessionId) -> PathBuf {
        self.holders().join(format!("{}.sock", session.0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uses_the_install_root_when_paths_fit() {
        let run = RunDir::for_root(Path::new("/home/u/.trc"), 1000);
        assert_eq!(run.dir, Path::new("/home/u/.trc/run"));
        assert_eq!(run.core_socket(), Path::new("/home/u/.trc/run/core.sock"));
        assert_eq!(run.core_lock(), Path::new("/home/u/.trc/run/core.lock"));
        let id = SessionId("0123456789abcdef".into());
        assert_eq!(
            run.holder_socket(&id),
            Path::new("/home/u/.trc/run/holders/0123456789abcdef.sock")
        );
    }

    #[test]
    fn falls_back_to_tmp_when_a_holder_socket_path_would_be_too_long() {
        let suffix_len = "/run/holders/0123456789abcdef.sock".len();
        let fits = format!("/{}", "a".repeat(MAX_SOCKET_PATH - suffix_len - 1));
        assert_eq!(
            RunDir::for_root(Path::new(&fits), 1000).dir,
            Path::new(&fits).join("run")
        );
        let too_long = format!("{fits}a");
        assert_eq!(
            RunDir::for_root(Path::new(&too_long), 1000).dir,
            Path::new("/tmp/trc-1000")
        );
    }
}
