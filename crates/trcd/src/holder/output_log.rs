//! The session's recent output, numbered by offset, so a client that reconnects gets only what it missed
//! (US-2.2.2).

use std::collections::VecDeque;

/// How much raw output a session keeps for reconnects; older output is reached through a snapshot instead.
pub const OUTPUT_LOG_BYTES: usize = 1024 * 1024;

/// Every output byte the session produced has an offset; the log keeps the last [`OUTPUT_LOG_BYTES`] of them.
#[derive(Debug)]
pub struct OutputLog {
    end: u64,
    kept: VecDeque<u8>,
    capacity: usize,
}

impl Default for OutputLog {
    fn default() -> Self {
        Self::with_capacity(OUTPUT_LOG_BYTES)
    }
}

impl OutputLog {
    /// A log that keeps the last `capacity` bytes.
    pub fn with_capacity(capacity: usize) -> Self {
        Self {
            end: 0,
            kept: VecDeque::with_capacity(capacity.min(64 * 1024)),
            capacity,
        }
    }

    /// The offset the next output byte will have.
    pub fn end(&self) -> u64 {
        self.end
    }

    /// Records output, forgetting the oldest bytes beyond the capacity.
    pub fn push(&mut self, bytes: &[u8]) {
        self.end += bytes.len() as u64;
        let keep = bytes.len().min(self.capacity);
        let overflow = (self.kept.len() + keep).saturating_sub(self.capacity);
        self.kept.drain(..overflow);
        self.kept.extend(&bytes[bytes.len() - keep..]);
    }

    /// The output from `offset` to the end, or `None` when the log no longer holds `offset` or it lies ahead.
    pub fn since(&self, offset: u64) -> Option<Vec<u8>> {
        let start = self.end - self.kept.len() as u64;
        if offset < start || offset > self.end {
            return None;
        }
        let skip = usize::try_from(offset - start).ok()?;
        Some(self.kept.iter().skip(skip).copied().collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_every_byte() {
        let mut log = OutputLog::default();
        log.push(b"hello");
        log.push(b" world");
        assert_eq!(log.end(), 11);
        assert_eq!(log.since(6).as_deref(), Some(&b"world"[..]));
        assert_eq!(log.since(11).as_deref(), Some(&b""[..]));
    }

    #[test]
    fn keeps_only_the_most_recent_bytes() {
        let mut log = OutputLog::with_capacity(4);
        log.push(b"abc");
        log.push(b"defgh");
        assert_eq!(log.end(), 8);
        assert_eq!(log.since(4).as_deref(), Some(&b"efgh"[..]));
        assert_eq!(log.since(3), None);
    }

    #[test]
    fn keeps_the_tail_of_a_push_larger_than_the_log() {
        let mut log = OutputLog::with_capacity(3);
        log.push(b"0123456789");
        assert_eq!(log.since(7).as_deref(), Some(&b"789"[..]));
    }

    #[test]
    fn refuses_an_offset_it_has_not_reached() {
        let mut log = OutputLog::default();
        log.push(b"abc");
        assert_eq!(log.since(4), None);
    }
}
