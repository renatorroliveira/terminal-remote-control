//! The clients attached to one session (D-04, US-2.6): each gets what it lacks, then live output within its own
//! credit. The holder never stops reading the PTY: a client whose queue overflows skips to the latest screen once it
//! catches up, and asks for the whole scrollback again (`refresh`) when it wants the rows it skipped (D-45).

use std::collections::{BTreeMap, VecDeque};
use std::time::{Duration, Instant};

use trc_protocol::frame::MAX_OUTPUT_CHUNK;
use trc_protocol::{Replay, ResyncKind};
use trc_vt::{GhosttyTerminal, SnapshotScope, SnapshotStream};

use super::output_log::OutputLog;
use super::protocol::HolderEvent;

/// Output a client may have waiting beyond its credit before it falls behind.
pub const MAX_QUEUE: usize = 1024 * 1024;
/// Credit a client that fell behind must have back before it is resynced: it has caught up with half of a window.
pub const RESYNC_CREDIT: usize = 512 * 1024;
/// History rows formatted per snapshot block.
const ROWS_PER_BLOCK: u32 = 256;
/// How often a client hears that another one typed (US-2.6.4).
const PEER_INPUT_INTERVAL: Duration = Duration::from_secs(1);
/// The in-band reset that starts a protocol 1 client's resync.
const RESET: &[u8] = b"\x1bc";

/// Something to send to the core.
#[derive(Debug, PartialEq, Eq)]
pub enum Outgoing {
    /// Output for an attachment, within its credit and at most one protocol chunk.
    Output(u32, Vec<u8>),
    /// A control event.
    Event(HolderEvent),
}

/// What an attachment needs from the session's terminal and output.
pub struct Session<'a> {
    /// The emulator, once the session has started.
    pub terminal: Option<&'a GhosttyTerminal>,
    /// The output log.
    pub log: &'a OutputLog,
    /// History rows a snapshot sends before it gives up catching up with output.
    pub max_rows: usize,
}

/// Every attachment of a session.
#[derive(Default)]
pub struct Attachments {
    list: BTreeMap<u32, Attachment>,
}

struct Attachment {
    credit: usize,
    queue: VecDeque<Item>,
    queued: usize,
    state: State,
    legacy: bool,
    told_peer_input: Option<Instant>,
}

enum Item {
    Output(Vec<u8>),
    Event(HolderEvent),
}

enum State {
    Live,
    Behind,
    Streaming {
        stream: Option<SnapshotStream>,
        scope: SnapshotScope,
    },
}

impl Attachments {
    /// Starts attachment `id`: the output since `from_offset` when the log still holds it, otherwise a snapshot.
    /// A legacy (protocol 1) client always gets a snapshot.
    pub fn attach(&mut self, id: u32, credit: u32, from_offset: Option<u64>, legacy: bool, session: &Session<'_>) {
        let mut attachment = Attachment {
            credit: credit as usize,
            queue: VecDeque::new(),
            queued: 0,
            state: State::Live,
            legacy,
            told_peer_input: None,
        };
        match from_offset
            .filter(|_| !legacy)
            .and_then(|offset| session.log.since(offset))
        {
            Some(missed) => {
                attachment.event(HolderEvent::Attached {
                    attachment: id,
                    replay: Replay::Delta,
                });
                attachment.output(missed);
                attachment.event(HolderEvent::Synced {
                    attachment: id,
                    offset: session.log.end(),
                });
            }
            None => {
                attachment.event(HolderEvent::Attached {
                    attachment: id,
                    replay: Replay::Snapshot,
                });
                attachment.stream(SnapshotScope::Full, session);
            }
        }
        self.list.insert(id, attachment);
    }

    /// Ends attachment `id`, or every attachment.
    pub fn detach(&mut self, id: Option<u32>) {
        match id {
            Some(id) => {
                self.list.remove(&id);
            }
            None => self.list.clear(),
        }
    }

    /// Whether no client is attached.
    pub fn is_empty(&self) -> bool {
        self.list.is_empty()
    }

    /// Adds credit a client granted; a client that fell behind and has caught up is resynced.
    pub fn grant(&mut self, id: u32, bytes: u32, session: &Session<'_>) {
        let Some(attachment) = self.list.get_mut(&id) else {
            return;
        };
        attachment.credit = attachment.credit.saturating_add(bytes as usize);
        if matches!(attachment.state, State::Behind) && attachment.credit >= RESYNC_CREDIT {
            attachment.resync(id, session);
        }
    }

    /// Sends attachment `id` the whole scrollback and screen again.
    pub fn refresh(&mut self, id: u32, session: &Session<'_>) {
        let Some(attachment) = self.list.get_mut(&id) else {
            return;
        };
        if attachment.legacy {
            return;
        }
        attachment.clear();
        attachment.event(HolderEvent::Resync {
            attachment: id,
            kind: ResyncKind::Full,
        });
        attachment.stream(SnapshotScope::Full, session);
    }

    /// Queues live output for every attachment that is up to date; one whose queue overflows falls behind.
    pub fn push(&mut self, output: &[u8]) {
        for attachment in self.list.values_mut() {
            if matches!(attachment.state, State::Live) {
                attachment.live(output);
            }
        }
    }

    /// Tells every other attachment that `from` sent input, at most once a second each (US-2.6.4).
    pub fn input_from(&mut self, from: u32, now: Instant) -> Vec<Outgoing> {
        let mut told = Vec::new();
        for (&id, attachment) in self.list.iter_mut().filter(|(id, _)| **id != from) {
            if attachment
                .told_peer_input
                .is_none_or(|last| now.duration_since(last) >= PEER_INPUT_INTERVAL)
            {
                attachment.told_peer_input = Some(now);
                told.push(Outgoing::Event(HolderEvent::PeerInput { attachment: id }));
            }
        }
        told
    }

    /// Takes everything the attachments may send now, formatting snapshot blocks as credit allows.
    pub fn drain(&mut self, session: &Session<'_>) -> Vec<Outgoing> {
        let mut out = Vec::new();
        for (&id, attachment) in &mut self.list {
            attachment.drain(id, session, &mut out);
        }
        out
    }
}

impl Attachment {
    fn event(&mut self, event: HolderEvent) {
        self.queue.push_back(Item::Event(event));
    }

    fn output(&mut self, bytes: Vec<u8>) {
        if !bytes.is_empty() {
            self.queued += bytes.len();
            self.queue.push_back(Item::Output(bytes));
        }
    }

    fn clear(&mut self) {
        self.queue
            .retain(|item| matches!(item, Item::Event(HolderEvent::Attached { .. })));
        self.queued = 0;
    }

    fn stream(&mut self, scope: SnapshotScope, session: &Session<'_>) {
        let stream = session
            .terminal
            .and_then(|terminal| SnapshotStream::new(terminal, scope, session.max_rows).ok());
        self.state = State::Streaming { stream, scope };
    }

    fn live(&mut self, output: &[u8]) {
        if self.queued + output.len() > MAX_QUEUE {
            self.clear();
            self.state = State::Behind;
        } else {
            self.output(output.to_vec());
        }
    }

    fn resync(&mut self, id: u32, session: &Session<'_>) {
        if self.legacy {
            self.output(RESET.to_vec());
            self.stream(SnapshotScope::Full, session);
            return;
        }
        self.event(HolderEvent::Resync {
            attachment: id,
            kind: ResyncKind::Screen,
        });
        self.stream(SnapshotScope::Screen, session);
    }

    fn drain(&mut self, id: u32, session: &Session<'_>, out: &mut Vec<Outgoing>) {
        loop {
            let progressed = match self.queue.front() {
                Some(Item::Event(_)) => self.send_event(out),
                Some(Item::Output(_)) => self.send_output(id, out),
                None => self.credit > 0 && self.next_block(id, session),
            };
            if !progressed {
                return;
            }
        }
    }

    fn send_event(&mut self, out: &mut Vec<Outgoing>) -> bool {
        if let Some(Item::Event(event)) = self.queue.pop_front() {
            out.push(Outgoing::Event(event));
        }
        true
    }

    /// Sends what the credit allows of the output at the front of the queue, at most one protocol chunk.
    fn send_output(&mut self, id: u32, out: &mut Vec<Outgoing>) -> bool {
        let Some(Item::Output(bytes)) = self.queue.front_mut() else {
            return false;
        };
        let size = bytes.len().min(self.credit).min(MAX_OUTPUT_CHUNK);
        if size == 0 {
            return false;
        }
        let chunk: Vec<u8> = bytes.drain(..size).collect();
        if bytes.is_empty() {
            self.queue.pop_front();
        }
        self.credit -= size;
        self.queued -= size;
        out.push(Outgoing::Output(id, chunk));
        true
    }

    /// Queues the next snapshot block, or ends the snapshot. Returns whether anything was queued.
    fn next_block(&mut self, id: u32, session: &Session<'_>) -> bool {
        let State::Streaming { stream, scope } = &mut self.state else {
            return false;
        };
        let scope = *scope;
        let block = match (stream.as_mut(), session.terminal) {
            (Some(stream), Some(terminal)) => stream.next_block(terminal, ROWS_PER_BLOCK).ok().flatten(),
            _ => None,
        };
        if let Some(block) = block {
            self.output(block);
            return true;
        }
        let complete = stream.as_ref().is_none_or(SnapshotStream::complete);
        if scope == SnapshotScope::Full && !complete && !self.legacy {
            self.clear();
            self.resync(id, session);
        } else {
            self.state = State::Live;
            self.event(HolderEvent::Synced {
                attachment: id,
                offset: session.log.end(),
            });
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use trc_vt::{Rgb, TerminalConfig, TerminalSize, TerminalState};

    use super::*;

    fn terminal() -> GhosttyTerminal {
        GhosttyTerminal::new(&TerminalConfig {
            size: TerminalSize { cols: 40, rows: 5 },
            scrollback_lines: 1_000,
            xtversion: "trcd test".into(),
            foreground: Rgb(1, 1, 1),
            background: Rgb(0, 0, 0),
        })
        .unwrap()
    }

    struct Fixture {
        terminal: GhosttyTerminal,
        log: OutputLog,
        attachments: Attachments,
    }

    impl Fixture {
        fn new() -> Self {
            Self {
                terminal: terminal(),
                log: OutputLog::default(),
                attachments: Attachments::default(),
            }
        }

        fn session(&self) -> Session<'_> {
            Session {
                terminal: Some(&self.terminal),
                log: &self.log,
                max_rows: 10_000,
            }
        }

        fn output(&mut self, bytes: &[u8]) {
            self.terminal.feed(bytes);
            self.log.push(bytes);
            self.attachments.push(bytes);
        }

        fn attach(&mut self, id: u32, credit: u32, from_offset: Option<u64>, legacy: bool) {
            let session = Session {
                terminal: Some(&self.terminal),
                log: &self.log,
                max_rows: 10_000,
            };
            self.attachments.attach(id, credit, from_offset, legacy, &session);
        }

        fn grant(&mut self, id: u32, bytes: u32) {
            let session = Session {
                terminal: Some(&self.terminal),
                log: &self.log,
                max_rows: 10_000,
            };
            self.attachments.grant(id, bytes, &session);
        }

        fn drain(&mut self) -> Vec<Outgoing> {
            let session = Session {
                terminal: Some(&self.terminal),
                log: &self.log,
                max_rows: 10_000,
            };
            self.attachments.drain(&session)
        }
    }

    fn output_of(items: &[Outgoing], id: u32) -> Vec<u8> {
        items
            .iter()
            .filter_map(|item| match item {
                Outgoing::Output(to, bytes) if *to == id => Some(bytes.clone()),
                _ => None,
            })
            .flatten()
            .collect()
    }

    fn events(items: &[Outgoing]) -> Vec<&HolderEvent> {
        items
            .iter()
            .filter_map(|item| match item {
                Outgoing::Event(event) => Some(event),
                Outgoing::Output(..) => None,
            })
            .collect()
    }

    #[test]
    fn replays_only_the_missed_output_from_an_offset_it_still_holds() {
        let mut fixture = Fixture::new();
        fixture.output(b"before ");
        let offset = fixture.log.end();
        fixture.output(b"missed");
        fixture.attach(2, 1_000, Some(offset), false);
        let sent = fixture.drain();
        assert_eq!(output_of(&sent, 2), b"missed");
        assert_eq!(
            events(&sent),
            [
                &HolderEvent::Attached {
                    attachment: 2,
                    replay: Replay::Delta
                },
                &HolderEvent::Synced {
                    attachment: 2,
                    offset: 13
                }
            ]
        );
    }

    #[test]
    fn sends_a_snapshot_that_recreates_the_terminal_then_live_output() {
        let mut fixture = Fixture::new();
        fixture.output(&"history line\r\n".repeat(50).into_bytes());
        fixture.output(b"prompt$ ");
        fixture.attach(1, u32::MAX, None, false);
        let sent = fixture.drain();
        let mut replay = terminal();
        replay.feed(&output_of(&sent, 1));
        assert_eq!(replay.plain_text().unwrap(), fixture.terminal.plain_text().unwrap());
        assert!(matches!(
            events(&sent)[..],
            [
                HolderEvent::Attached {
                    replay: Replay::Snapshot,
                    ..
                },
                HolderEvent::Synced { offset: 708, .. }
            ]
        ));
        fixture.output(b"ls");
        assert_eq!(output_of(&fixture.drain(), 1), b"ls");
    }

    #[test]
    fn falls_back_to_a_snapshot_when_the_offset_is_gone() {
        let mut fixture = Fixture::new();
        fixture.output(b"x");
        fixture.attach(1, u32::MAX, Some(99), false);
        assert!(matches!(
            events(&fixture.drain())[0],
            HolderEvent::Attached {
                replay: Replay::Snapshot,
                ..
            }
        ));
    }

    #[test]
    fn sends_nothing_beyond_the_credit_and_resumes_when_granted() {
        let mut fixture = Fixture::new();
        fixture.attach(1, 0, Some(0), false);
        fixture.drain();
        fixture.output(b"0123456789");
        assert_eq!(output_of(&fixture.drain(), 1), b"");
        fixture.grant(1, 4);
        assert_eq!(output_of(&fixture.drain(), 1), b"0123");
        fixture.grant(1, 100);
        assert_eq!(output_of(&fixture.drain(), 1), b"456789");
    }

    #[test]
    fn a_slow_client_skips_to_the_screen_without_slowing_another() {
        let mut fixture = Fixture::new();
        fixture.attach(1, 0, Some(0), false);
        fixture.attach(2, u32::MAX, Some(0), false);
        fixture.drain();
        let flood = vec![b'y'; MAX_QUEUE / 2];
        let mut fast = Vec::new();
        for _ in 0..3 {
            fixture.output(&flood);
            fast.extend(fixture.drain());
        }
        assert_eq!(output_of(&fast, 2).len(), MAX_QUEUE / 2 * 3);
        assert_eq!(output_of(&fast, 1), b"");
        fixture.grant(1, RESYNC_CREDIT as u32);
        let resynced = fixture.drain();
        assert!(matches!(
            events(&resynced)[..],
            [
                HolderEvent::Resync {
                    attachment: 1,
                    kind: ResyncKind::Screen
                },
                HolderEvent::Synced { attachment: 1, .. }
            ]
        ));
        let mut replay = terminal();
        replay.feed(&output_of(&resynced, 1));
        assert_eq!(replay.cursor(), fixture.terminal.cursor());
    }

    #[test]
    fn a_legacy_client_that_falls_behind_gets_a_reset_and_the_whole_snapshot() {
        let mut fixture = Fixture::new();
        fixture.attach(1, 100_000, None, true);
        fixture.drain();
        fixture.output(&vec![b'y'; MAX_QUEUE + 100_001]);
        fixture.grant(1, u32::MAX);
        let sent = output_of(&fixture.drain(), 1);
        assert!(sent.windows(2).any(|pair| pair == RESET), "no reset in the resync");
    }

    #[test]
    fn refresh_sends_the_whole_scrollback_again() {
        let mut fixture = Fixture::new();
        fixture.output(&"old\r\n".repeat(20).into_bytes());
        fixture.attach(1, u32::MAX, Some(fixture.log.end()), false);
        fixture.drain();
        let mut attachments = std::mem::take(&mut fixture.attachments);
        let session = fixture.session();
        attachments.refresh(1, &session);
        let sent = attachments.drain(&session);
        assert!(matches!(
            events(&sent)[0],
            HolderEvent::Resync {
                kind: ResyncKind::Full,
                ..
            }
        ));
        assert_eq!(String::from_utf8_lossy(&output_of(&sent, 1)).matches("old").count(), 20);
    }

    #[test]
    fn tells_the_others_about_input_at_most_once_a_second() {
        let mut fixture = Fixture::new();
        fixture.attach(1, 10, Some(0), false);
        fixture.attach(2, 10, Some(0), false);
        let start = Instant::now();
        assert_eq!(
            fixture.attachments.input_from(1, start),
            [Outgoing::Event(HolderEvent::PeerInput { attachment: 2 })]
        );
        assert_eq!(
            fixture.attachments.input_from(1, start + Duration::from_millis(500)),
            []
        );
        assert_eq!(
            fixture.attachments.input_from(1, start + Duration::from_secs(1)).len(),
            1
        );
    }
}
