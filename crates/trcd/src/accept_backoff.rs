//! A pause after a failed `accept`, so a listener that keeps failing (`EMFILE`, `ENFILE`) neither spins a CPU nor
//! starves the other branches of an event loop (NFR-09).

use std::time::Duration;

use tokio::time::{Instant, sleep_until};

/// How long a listener rests after a failed `accept`.
pub const ACCEPT_BACKOFF: Duration = Duration::from_millis(100);

/// Whether a listener may accept now, or rests after a failure.
#[derive(Debug, Default)]
pub struct AcceptBackoff {
    resume_at: Option<Instant>,
}

impl AcceptBackoff {
    /// Rests the listener for [`ACCEPT_BACKOFF`] after a failed `accept`.
    pub fn failed(&mut self) {
        self.resume_at = Some(Instant::now() + ACCEPT_BACKOFF);
    }

    /// Whether the listener may accept now.
    pub fn ready(&self) -> bool {
        self.resume_at.is_none()
    }

    /// Completes when the rest ends; never while the listener is ready, so a `select!` branch can wait on it.
    pub async fn rested(&self) {
        match self.resume_at {
            Some(deadline) => sleep_until(deadline).await,
            None => std::future::pending().await,
        }
    }

    /// Lets the listener accept again once its rest has ended.
    pub fn resume(&mut self) {
        self.resume_at = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn rests_a_failed_listener_for_a_moment_then_lets_it_accept_again() {
        let mut backoff = AcceptBackoff::default();
        assert!(backoff.ready());
        backoff.failed();
        assert!(!backoff.ready());
        let started = Instant::now();
        backoff.rested().await;
        assert!(started.elapsed() >= ACCEPT_BACKOFF && started.elapsed() < Duration::from_secs(1));
        backoff.resume();
        assert!(backoff.ready());
    }

    #[tokio::test]
    async fn never_completes_its_rest_while_ready() {
        let backoff = AcceptBackoff::default();
        let waited = tokio::time::timeout(ACCEPT_BACKOFF * 3, backoff.rested()).await;
        assert!(waited.is_err());
    }
}
