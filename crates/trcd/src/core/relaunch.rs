//! A limit on bringing back a session whose holder keeps ending (US-3.1): after a few endings in a short time the
//! session is left failed instead, so a holder that cannot run never starts again and again.

use std::collections::BTreeMap;

use trc_protocol::SessionId;

/// How many holder endings within [`WINDOW_MS`] keep a session from coming back.
pub const MAX_ENDINGS: usize = 3;
/// The time over which holder endings are counted, in milliseconds: long enough that a holder ending every 30 s, as
/// often as a restore may follow another, still stops.
pub const WINDOW_MS: u64 = 600_000;

/// When each session's holder last ended.
#[derive(Debug, Default)]
pub struct EndedHolders {
    endings: BTreeMap<SessionId, Vec<u64>>,
}

impl EndedHolders {
    /// Counts a holder ending at `now`, and says whether its session may come back.
    pub fn may_return(&mut self, session: &SessionId, now: u64) -> bool {
        let times = self.endings.entry(session.clone()).or_default();
        times.retain(|at| now.saturating_sub(*at) < WINDOW_MS);
        times.push(now);
        times.len() < MAX_ENDINGS
    }

    /// Forgets a session's holder endings, as starting it again by hand or closing it asks.
    pub fn forget(&mut self, session: &SessionId) {
        self.endings.remove(session);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id() -> SessionId {
        SessionId("0123456789abcdef".into())
    }

    #[test]
    fn stops_bringing_back_a_session_whose_holder_keeps_ending() {
        let mut ended = EndedHolders::default();
        let returns: Vec<bool> = (0..MAX_ENDINGS as u64)
            .map(|n| ended.may_return(&id(), 1_000 + n))
            .collect();
        assert_eq!(returns, [true, true, false]);
    }

    #[test]
    fn counts_only_the_endings_of_the_last_ten_minutes() {
        let mut ended = EndedHolders::default();
        assert!(ended.may_return(&id(), 0));
        assert!(ended.may_return(&id(), 1));
        assert!(ended.may_return(&id(), WINDOW_MS + 1));
    }

    #[test]
    fn starts_counting_again_once_forgotten() {
        let mut ended = EndedHolders::default();
        ended.may_return(&id(), 0);
        ended.may_return(&id(), 1);
        ended.forget(&id());
        assert!(ended.may_return(&id(), 2));
    }
}
