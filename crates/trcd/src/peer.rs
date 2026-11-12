//! Peer authentication for Unix sockets by OS identity (SEC-02).

use tokio::net::UnixStream;

/// Returns whether the process at the other end of `stream` runs as this process's effective user.
pub fn is_same_user(stream: &UnixStream) -> bool {
    stream
        .peer_cred()
        .is_ok_and(|credentials| credentials.uid() == rustix::process::geteuid().as_raw())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn accepts_a_peer_of_the_same_user() {
        let (left, right) = UnixStream::pair().unwrap();
        assert!(is_same_user(&left));
        assert!(is_same_user(&right));
    }
}
