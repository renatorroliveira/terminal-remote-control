//! Credit-based flow control for one attached client (D-19): output waits while the client has no credit, and the
//! holder stops reading the PTY until it has room again, so programs block as in any terminal.

use std::collections::VecDeque;

use trc_protocol::frame::MAX_OUTPUT_CHUNK;

/// Output on its way to the attached client.
#[derive(Debug, Default)]
pub struct OutputGate {
    attached: bool,
    credit: usize,
    pending: VecDeque<Vec<u8>>,
}

impl OutputGate {
    /// Attaches a client with an initial credit and queues the snapshot it receives first.
    pub fn attach(&mut self, credit: u32, snapshot: Vec<u8>) {
        self.attached = true;
        self.credit = credit as usize;
        self.pending.clear();
        self.push(snapshot);
    }

    /// Detaches the client and drops what it has not received.
    pub fn detach(&mut self) {
        self.attached = false;
        self.credit = 0;
        self.pending.clear();
    }

    /// Adds credit the client granted.
    pub fn grant(&mut self, bytes: u32) {
        if self.attached {
            self.credit = self.credit.saturating_add(bytes as usize);
        }
    }

    /// Queues output read from the PTY. Without a client the output only feeds the emulator and is dropped here.
    pub fn push(&mut self, output: Vec<u8>) {
        if self.attached && !output.is_empty() {
            self.pending.push_back(output);
        }
    }

    /// Takes the next chunk the client may receive now, at most [`MAX_OUTPUT_CHUNK`] bytes and never more than its
    /// credit.
    pub fn next_chunk(&mut self) -> Option<Vec<u8>> {
        let size = self.pending.front()?.len().min(MAX_OUTPUT_CHUNK).min(self.credit);
        if size == 0 {
            return None;
        }
        let front = self.pending.front_mut()?;
        let chunk: Vec<u8> = front.drain(..size).collect();
        if front.is_empty() {
            self.pending.pop_front();
        }
        self.credit -= size;
        Some(chunk)
    }

    /// Whether the holder may read more PTY output: always when detached, otherwise only once the queue has drained.
    pub fn wants_output(&self) -> bool {
        !self.attached || self.pending.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn drain(gate: &mut OutputGate) -> Vec<Vec<u8>> {
        std::iter::from_fn(|| gate.next_chunk()).collect()
    }

    #[test]
    fn drops_output_and_keeps_reading_while_detached() {
        let mut gate = OutputGate::default();
        gate.push(b"lost".to_vec());
        assert!(drain(&mut gate).is_empty());
        assert!(gate.wants_output());
    }

    #[test]
    fn sends_the_snapshot_before_live_output() {
        let mut gate = OutputGate::default();
        gate.attach(1_000, b"snap".to_vec());
        gate.push(b"live".to_vec());
        assert_eq!(drain(&mut gate), [b"snap".to_vec(), b"live".to_vec()]);
    }

    #[test]
    fn stops_at_the_credit_and_resumes_when_granted() {
        let mut gate = OutputGate::default();
        gate.attach(5, Vec::new());
        gate.push(b"0123456789".to_vec());
        assert_eq!(drain(&mut gate), [b"01234".to_vec()]);
        assert!(!gate.wants_output());
        gate.grant(3);
        assert_eq!(drain(&mut gate), [b"567".to_vec()]);
        gate.grant(100);
        assert_eq!(drain(&mut gate), [b"89".to_vec()]);
        assert!(gate.wants_output());
    }

    #[test]
    fn splits_large_output_into_protocol_chunks() {
        let mut gate = OutputGate::default();
        gate.attach(u32::MAX, Vec::new());
        gate.push(vec![b'x'; MAX_OUTPUT_CHUNK * 2 + 1]);
        let sizes: Vec<usize> = drain(&mut gate).iter().map(Vec::len).collect();
        assert_eq!(sizes, [MAX_OUTPUT_CHUNK, MAX_OUTPUT_CHUNK, 1]);
    }

    #[test]
    fn detaching_drops_pending_output() {
        let mut gate = OutputGate::default();
        gate.attach(0, b"snapshot".to_vec());
        gate.detach();
        gate.attach(100, Vec::new());
        assert!(drain(&mut gate).is_empty());
    }
}
