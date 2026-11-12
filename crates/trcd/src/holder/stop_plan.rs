//! The graceful-then-forced stop sequence (US-1.10.2): SIGHUP, then SIGTERM after the grace period, then SIGKILL
//! after another.

use std::time::Duration;

/// A signal the stop sequence sends.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StopSignal {
    /// Hang up, as when a terminal closes.
    Hangup,
    /// Ask to terminate.
    Terminate,
    /// Force termination of the whole process group.
    Kill,
}

/// The default grace period between signals.
pub const DEFAULT_GRACE: Duration = Duration::from_secs(5);

/// Returns each signal with its delay after the stop request.
pub fn stop_plan(grace: Duration) -> [(Duration, StopSignal); 3] {
    [
        (Duration::ZERO, StopSignal::Hangup),
        (grace, StopSignal::Terminate),
        (grace * 2, StopSignal::Kill),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hangs_up_then_terminates_then_kills() {
        assert_eq!(
            stop_plan(Duration::from_millis(300)),
            [
                (Duration::ZERO, StopSignal::Hangup),
                (Duration::from_millis(300), StopSignal::Terminate),
                (Duration::from_millis(600), StopSignal::Kill),
            ]
        );
    }
}
