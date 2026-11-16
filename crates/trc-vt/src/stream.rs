//! Snapshots formatted a block of rows at a time (S12, NFR-09): the history first, from rows tracked as output
//! moves them, then the screen with the modes, cursor and styles that recreate it. While a full-screen program runs on
//! the alternate screen, the history waits: libghostty-vt formats only the active screen, and nothing shows the
//! primary screen until the program leaves (D-49).

use crate::VtError;
use crate::ghostty::{GhosttyTerminal, SNAPSHOT_EXTRAS};
use crate::grid::{ACTIVE, SCREEN, TrackedRow, format_rows, history_rows, screen_size, wraps};

/// What a snapshot recreates.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SnapshotScope {
    /// The scrollback and the screen.
    Full,
    /// Only the screen, for a client that skipped output (D-04).
    Screen,
}

/// A snapshot in progress. Each block is VT output that the previous blocks leave a terminal ready for; the last one
/// is the screen. Output may reach the terminal between blocks: rows it adds to the history are streamed too, rows
/// pruning removes are skipped, and the screen comes from the terminal as it is when the history is done.
pub struct SnapshotStream {
    /// Whether a whole-buffer snapshot started while a full-screen program ran, so it left out the history.
    deferred: bool,
    next: Option<TrackedRow>,
    sent: usize,
    /// Whether the last history row sent soft-wraps into the screen, so the cursor still sits on it.
    ends_wrapped: bool,
    max_rows: usize,
    phase: Phase,
    complete: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Phase {
    History,
    Screen,
    Done,
}

impl SnapshotStream {
    /// Starts a snapshot of `terminal`. `max_rows` bounds the history rows the stream sends before it gives up on
    /// catching up with output that keeps arriving. A whole-buffer snapshot that starts while a full-screen program
    /// runs sends that program's screen only, and says so with [`Self::history_deferred`].
    pub fn new(terminal: &GhosttyTerminal, scope: SnapshotScope, max_rows: usize) -> Result<Self, VtError> {
        let deferred = scope == SnapshotScope::Full && is_alternate(terminal);
        let source = terminal.raw();
        let next = if scope == SnapshotScope::Full && !deferred && history_rows(source) > 0 {
            Some(TrackedRow::new(source, 0)?)
        } else {
            None
        };
        Ok(Self {
            deferred,
            phase: if next.is_some() { Phase::History } else { Phase::Screen },
            next,
            sent: 0,
            ends_wrapped: false,
            max_rows,
            complete: true,
        })
    }

    /// Returns the next block of at most `rows` history rows, or the screen once the history is done, or `None` once
    /// the screen has been returned.
    pub fn next_block(&mut self, terminal: &GhosttyTerminal, rows: u32) -> Result<Option<Vec<u8>>, VtError> {
        if self.phase == Phase::History
            && let Some(block) = self.history_block(terminal, rows.max(1))?
        {
            return Ok(Some(block));
        }
        if self.phase == Phase::Done {
            return Ok(None);
        }
        self.phase = Phase::Done;
        self.screen_block(terminal).map(Some)
    }

    /// Whether the stream sent every history row it should have; false when output outran it and it skipped to the
    /// screen.
    pub fn complete(&self) -> bool {
        self.complete
    }

    /// Whether the screen, the last block, has been returned.
    pub fn is_done(&self) -> bool {
        self.phase == Phase::Done
    }

    /// Whether this whole-buffer snapshot left out the history because a full-screen program ran when it started;
    /// the client gets it once the program leaves the alternate screen (D-49).
    pub fn history_deferred(&self) -> bool {
        self.deferred
    }

    /// The next rows of history, or `None` once the history is done, which moves the stream on to the screen.
    fn history_block(&mut self, terminal: &GhosttyTerminal, rows: u32) -> Result<Option<Vec<u8>>, VtError> {
        let source = terminal.raw();
        let history = history_rows(source);
        let first = self.next.as_ref().map_or(Some(0), TrackedRow::y).unwrap_or(0);
        if first >= history || self.sent >= self.max_rows {
            self.complete = first >= history;
            self.phase = Phase::Screen;
            return Ok(None);
        }
        let last = first.saturating_add(rows).min(history) - 1;
        let mut block = format_rows(source, SCREEN, first, last, 0)?;
        self.ends_wrapped = wraps(source, SCREEN, last)?;
        if !self.ends_wrapped {
            block.extend_from_slice(b"\r\n");
        }
        self.next = Some(TrackedRow::new(source, last + 1)?);
        self.sent += (last - first + 1) as usize;
        Ok(Some(block))
    }

    /// The screen, with the modes, cursor and styles that recreate it. After history, line feeds first push every
    /// history row above the screen, since the screen's extras home the cursor; one more when the last history row
    /// wraps, as the cursor is still on it.
    fn screen_block(&self, terminal: &GhosttyTerminal) -> Result<Vec<u8>, VtError> {
        let live = terminal.raw();
        let (_, height) = screen_size(live);
        let last = u32::from(height.max(1)) - 1;
        let mut block = Vec::new();
        if self.sent > 0 {
            let feeds = usize::from(height.saturating_sub(1)) + usize::from(self.ends_wrapped);
            block.resize(feeds, b'\n');
        }
        block.extend_from_slice(b"\x1b[H");
        block.extend(format_rows(live, ACTIVE, 0, last, SNAPSHOT_EXTRAS)?);
        Ok(block)
    }
}

fn is_alternate(terminal: &GhosttyTerminal) -> bool {
    use crate::TerminalState;
    terminal.alternate_screen()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Rgb, TerminalConfig, TerminalSize, TerminalState};

    fn terminal(scrollback_lines: usize) -> GhosttyTerminal {
        GhosttyTerminal::new(&TerminalConfig {
            size: TerminalSize { cols: 80, rows: 24 },
            scrollback_lines,
            xtversion: "trcd test".into(),
            foreground: Rgb(1, 1, 1),
            background: Rgb(0, 0, 0),
        })
        .unwrap()
    }

    fn varied_lines(from: u32, count: u32) -> Vec<u8> {
        (from..from + count)
            .map(|i| match i % 5 {
                0 => format!("\x1b[1;31mline {i}\x1b[0m plain\r\n"),
                1 => format!("{} wraps {i}\r\n", "w".repeat(150)),
                2 => format!("\x1b[38;2;10;200;30m日本語 {i} 👩‍👩‍👧\x1b[0m\r\n"),
                3 => format!("\x1b[4mund\x1b[24m tab\tx {i}\r\n"),
                _ => format!("\x1b[7mrev {i}\r\n"),
            })
            .collect::<String>()
            .into_bytes()
    }

    fn drain(stream: &mut SnapshotStream, live: &GhosttyTerminal, rows: u32) -> Vec<u8> {
        let mut out = Vec::new();
        while let Some(block) = stream.next_block(live, rows).unwrap() {
            out.extend_from_slice(&block);
        }
        out
    }

    fn replayed(bytes: &[u8], scrollback_lines: usize) -> GhosttyTerminal {
        let mut replay = terminal(scrollback_lines);
        replay.feed(bytes);
        replay
    }

    fn assert_same(a: &GhosttyTerminal, b: &GhosttyTerminal) {
        assert_eq!(a.scrollback_rows(), b.scrollback_rows(), "scrollback rows");
        assert_eq!(a.cursor(), b.cursor(), "cursor");
        assert_eq!(a.alternate_screen(), b.alternate_screen(), "alternate screen");
        assert_eq!(a.plain_text().unwrap(), b.plain_text().unwrap(), "text");
        assert_eq!(a.snapshot().unwrap(), b.snapshot().unwrap(), "formatted state");
    }

    #[test]
    fn replays_like_the_whole_snapshot() {
        let mut live = terminal(100_000);
        live.feed(&varied_lines(0, 20_000));
        live.feed(b"\x1b[?2004h\x1b[5;10Hcursor here\x1b[1m");
        let mut stream = SnapshotStream::new(&live, SnapshotScope::Full, 200_000).unwrap();
        let streamed = drain(&mut stream, &live, 500);
        assert!(stream.complete());
        assert_same(
            &replayed(&streamed, 100_000),
            &replayed(&live.snapshot().unwrap(), 100_000),
        );
        assert_same(&replayed(&streamed, 100_000), &live);
    }

    #[test]
    fn never_returns_more_than_the_rows_asked_for() {
        let mut live = terminal(100_000);
        live.feed(&"0123456789\r\n".repeat(5_000).into_bytes());
        let mut stream = SnapshotStream::new(&live, SnapshotScope::Full, 200_000).unwrap();
        let first = stream.next_block(&live, 100).unwrap().unwrap();
        assert_eq!(first.iter().filter(|&&byte| byte == b'\n').count(), 100);
    }

    #[test]
    fn includes_output_that_arrives_while_it_streams() {
        let mut live = terminal(100_000);
        live.feed(&varied_lines(0, 3_000));
        let mut stream = SnapshotStream::new(&live, SnapshotScope::Full, 200_000).unwrap();
        let mut streamed = stream.next_block(&live, 500).unwrap().unwrap();
        live.feed(&varied_lines(3_000, 700));
        streamed.extend(drain(&mut stream, &live, 500));
        assert!(stream.complete());
        assert_same(&replayed(&streamed, 100_000), &live);
    }

    #[test]
    fn skips_rows_pruned_while_it_streams() {
        let mut live = terminal(1_000);
        live.feed(&"old\r\n".repeat(3_000).into_bytes());
        let mut stream = SnapshotStream::new(&live, SnapshotScope::Full, 100_000).unwrap();
        let mut streamed = stream.next_block(&live, 10).unwrap().unwrap();
        live.feed(&"new\r\n".repeat(5_000).into_bytes());
        streamed.extend(drain(&mut stream, &live, 500));
        let replay = replayed(&streamed, 1_000);
        assert_eq!(replay.cursor(), live.cursor());
        assert!(
            replay
                .plain_text()
                .unwrap()
                .ends_with(&live.plain_text().unwrap()[4_000..])
        );
    }

    #[test]
    fn skips_to_the_screen_when_output_outruns_it() {
        let mut live = terminal(1_000);
        live.feed(&"0\r\n".repeat(2_000).into_bytes());
        let mut stream = SnapshotStream::new(&live, SnapshotScope::Full, 1_500).unwrap();
        let mut streamed = Vec::new();
        for _ in 0..10 {
            let Some(block) = stream.next_block(&live, 200).unwrap() else {
                break;
            };
            streamed.extend(block);
            live.feed(&"1\r\n".repeat(400).into_bytes());
        }
        streamed.extend(drain(&mut stream, &live, 200));
        assert!(!stream.complete());
        let replay = replayed(&streamed, 1_000);
        assert_eq!(replay.cursor(), live.cursor());
    }

    #[test]
    fn defers_the_history_while_a_full_screen_program_runs() {
        let mut live = terminal(10_000);
        live.feed(&varied_lines(0, 500));
        live.feed(b"$ vim\r\n\x1b[?1049h\x1b[H\x1b[2Jediting\x1b[3;4H");
        let mut stream = SnapshotStream::new(&live, SnapshotScope::Full, 100_000).unwrap();
        let streamed = drain(&mut stream, &live, 100);
        assert!(stream.history_deferred());
        assert!(stream.complete());
        let replay = replayed(&streamed, 10_000);
        assert!(replay.alternate_screen());
        assert_eq!(replay.scrollback_rows(), 0);
        assert_eq!(replay.cursor(), live.cursor());
        assert_eq!(replay.plain_text().unwrap(), live.plain_text().unwrap());
    }

    #[test]
    fn sends_the_history_once_the_full_screen_program_has_left() {
        let mut live = terminal(10_000);
        live.feed(&varied_lines(0, 500));
        live.feed(b"$ vim\r\n\x1b[?1049h\x1b[H\x1b[2Jediting\x1b[?1049l$ ");
        let mut stream = SnapshotStream::new(&live, SnapshotScope::Full, 100_000).unwrap();
        let streamed = drain(&mut stream, &live, 100);
        assert!(!stream.history_deferred());
        assert_same(&replayed(&streamed, 10_000), &live);
    }

    #[test]
    fn sends_only_the_screen_for_a_screen_resync() {
        let mut live = terminal(10_000);
        live.feed(&varied_lines(0, 2_000));
        live.feed(b"\x1b[2;3Htop");
        let mut stream = SnapshotStream::new(&live, SnapshotScope::Screen, 100_000).unwrap();
        let streamed = drain(&mut stream, &live, 500);
        let replay = replayed(&streamed, 10_000);
        assert_eq!(replay.scrollback_rows(), 0);
        assert_eq!(replay.cursor(), live.cursor());
        let (live_text, replay_text) = (live.plain_text().unwrap(), replay.plain_text().unwrap());
        let shown: Vec<&str> = replay_text.lines().collect();
        let screen: Vec<&str> = live_text
            .lines()
            .skip(live_text.lines().count() - shown.len())
            .collect();
        assert!(shown.len() >= 20, "{shown:?}");
        assert_eq!(shown, screen);
    }
}
