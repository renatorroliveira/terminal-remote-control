//! What a session saves to disk as it runs (TECH_STACK §5.5, NFR-08): the rows that leave the primary screen,
//! formatted as they go, and the primary screen itself, so a new terminal fed both shows the same text and styles.

use crate::VtError;
use crate::ghostty::GhosttyTerminal;
use crate::grid::SCREEN;
use crate::grid::{TrackedRow, history_rows, wraps};
use crate::marks::format_marked;

/// Rows taken from a terminal's history: VT output that continues the rows taken before.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HistoryRows {
    /// The rows, formatted with their styles; a row that soft-wraps into the next carries no line break.
    pub bytes: Vec<u8>,
    /// How many rows the bytes hold.
    pub rows: u32,
}

/// Follows a terminal's history and formats the rows added to it since it last did, a block at a time. Rows that
/// pruning removes before they are taken are skipped, and nothing is taken while the alternate screen is active,
/// where the history does not grow.
pub struct HistoryTail {
    next: Option<TrackedRow>,
}

impl HistoryTail {
    /// Follows `terminal` from its first history row, to save every row it holds.
    pub fn from_start() -> Self {
        Self { next: None }
    }

    /// Follows `terminal` from the first row after its history, when every row it holds is saved already.
    pub fn after(terminal: &GhosttyTerminal) -> Result<Self, VtError> {
        let raw = terminal.raw();
        Ok(Self {
            next: Some(TrackedRow::new(raw, history_rows(raw))?),
        })
    }

    /// Formats at most `max_rows` history rows that came after the last ones taken, or `None` when there are none.
    pub fn take(&mut self, terminal: &GhosttyTerminal, max_rows: u32) -> Result<Option<HistoryRows>, VtError> {
        if is_alternate(terminal) {
            return Ok(None);
        }
        let raw = terminal.raw();
        let history = history_rows(raw);
        let first = self.next.as_ref().map_or(Some(0), TrackedRow::y).unwrap_or(0);
        if first >= history {
            return Ok(None);
        }
        let last = first.saturating_add(max_rows.max(1)).min(history) - 1;
        let mut bytes = format_marked(raw, terminal.marks(), first, last)?;
        if !wraps(raw, SCREEN, last)? {
            bytes.extend_from_slice(b"\r\n");
        }
        self.next = Some(TrackedRow::new(raw, last + 1)?);
        Ok(Some(HistoryRows {
            bytes,
            rows: last - first + 1,
        }))
    }
}

/// The primary screen down to the cursor's row, formatted with its styles, or `None` while the alternate screen is
/// active, as libghostty-vt formats only the active screen.
pub fn primary_screen(terminal: &GhosttyTerminal) -> Result<Option<Vec<u8>>, VtError> {
    if is_alternate(terminal) {
        return Ok(None);
    }
    let (_, cursor_row) = crate::TerminalState::cursor(terminal);
    let raw = terminal.raw();
    let top = history_rows(raw);
    let mut bytes = format_marked(raw, terminal.marks(), top, top + u32::from(cursor_row))?;
    bytes.extend_from_slice(b"\r\n");
    Ok(Some(bytes))
}

fn is_alternate(terminal: &GhosttyTerminal) -> bool {
    crate::TerminalState::alternate_screen(terminal)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Rgb, TerminalConfig, TerminalSize, TerminalState};

    fn terminal(scrollback_lines: usize) -> GhosttyTerminal {
        GhosttyTerminal::new(&TerminalConfig {
            size: TerminalSize { cols: 40, rows: 10 },
            scrollback_lines,
            xtversion: "trcd test".into(),
            foreground: Rgb(1, 1, 1),
            background: Rgb(0, 0, 0),
        })
        .unwrap()
    }

    fn lines(from: u32, count: u32) -> Vec<u8> {
        (from..from + count)
            .map(|i| match i % 3 {
                0 => format!("\x1b[1;31mline {i}\x1b[0m\r\n"),
                1 => format!("{} wraps {i}\r\n", "w".repeat(70)),
                _ => format!("日本語 {i}\r\n"),
            })
            .collect::<String>()
            .into_bytes()
    }

    fn take_all(tail: &mut HistoryTail, live: &GhosttyTerminal, rows: u32) -> Vec<u8> {
        let mut out = Vec::new();
        while let Some(taken) = tail.take(live, rows).unwrap() {
            out.extend(taken.bytes);
        }
        out
    }

    /// The text a terminal shows once fed what was saved: the history, then the screen.
    fn restored(saved: &[u8]) -> String {
        let mut replay = terminal(10_000);
        replay.feed(saved);
        replay.plain_text().unwrap()
    }

    #[test]
    fn saves_every_row_as_it_leaves_the_screen_in_blocks() {
        let mut live = terminal(10_000);
        let mut tail = HistoryTail::from_start();
        let mut saved = Vec::new();
        for round in 0..5 {
            live.feed(&lines(round * 40, 40));
            saved.extend(take_all(&mut tail, &live, 7));
        }
        saved.extend(primary_screen(&live).unwrap().unwrap());
        assert_eq!(restored(&saved).trim_end(), live.plain_text().unwrap().trim_end());
    }

    #[test]
    fn saves_every_mark_with_the_rows_it_marks_d_56() {
        let mut live = terminal(10_000);
        let mut tail = HistoryTail::from_start();
        let mut saved = Vec::new();
        live.feed(&crate::marks::tests::command("build", 30, 0));
        saved.extend(take_all(&mut tail, &live, 4));
        live.feed(&crate::marks::tests::command("test", 2, 3));
        live.feed(b"\x1b]133;A\x07$ ");
        saved.extend(take_all(&mut tail, &live, 4));
        saved.extend(primary_screen(&live).unwrap().unwrap());
        let mut replay = terminal(10_000);
        replay.feed(&saved);
        assert_eq!(replay.marks().in_rows(0, u32::MAX), live.marks().in_rows(0, u32::MAX));
    }

    #[test]
    fn takes_nothing_twice_and_says_how_many_rows_it_took() {
        let mut live = terminal(10_000);
        live.feed(&"0123\r\n".repeat(25).into_bytes());
        let mut tail = HistoryTail::from_start();
        let first = tail.take(&live, 100).unwrap().unwrap();
        assert_eq!(first.rows, 16);
        assert_eq!(tail.take(&live, 100).unwrap(), None);
        live.feed(b"a\r\nb\r\n");
        assert_eq!(tail.take(&live, 100).unwrap().map(|taken| taken.rows), Some(2));
    }

    #[test]
    fn starts_after_the_rows_a_restored_terminal_already_holds() {
        let mut live = terminal(10_000);
        live.feed(&"old\r\n".repeat(30).into_bytes());
        let mut tail = HistoryTail::after(&live).unwrap();
        assert_eq!(tail.take(&live, 100).unwrap(), None);
        live.feed(b"new\r\n");
        let taken = tail.take(&live, 100).unwrap().unwrap();
        assert_eq!(taken.rows, 1);
    }

    #[test]
    fn skips_rows_pruned_before_it_took_them() {
        let mut live = terminal(100);
        let mut tail = HistoryTail::from_start();
        live.feed(&"0123\r\n".repeat(500).into_bytes());
        let taken = take_all(&mut tail, &live, 1_000);
        assert!(String::from_utf8_lossy(&taken).matches("0123").count() <= live.scrollback_rows());
        live.feed(b"after\r\n");
        assert!(String::from_utf8_lossy(&take_all(&mut tail, &live, 1_000)).contains("0123"));
    }

    #[test]
    fn waits_while_a_full_screen_program_runs() {
        let mut live = terminal(10_000);
        live.feed(&lines(0, 20));
        let mut tail = HistoryTail::from_start();
        take_all(&mut tail, &live, 100);
        let screen = primary_screen(&live).unwrap().unwrap();
        live.feed(b"\x1b[?1049h\x1b[Hediting\r\n");
        assert_eq!(tail.take(&live, 100).unwrap(), None);
        assert_eq!(primary_screen(&live).unwrap(), None);
        live.feed(b"\x1b[?1049l");
        assert_eq!(primary_screen(&live).unwrap(), Some(screen));
    }
}
