//! Shell-integration marks kept on the rows they mark (OSC 133, US-5.2, D-56). libghostty-vt's formatter writes no
//! OSC 133, so the marks of every prompt, command output and command end are kept here, each on a row that follows
//! its content as output scrolls it, and written back into snapshots and saved history: a terminal fed those gets the
//! same marks the live one has.
//!
//! Steps are taken as shells send them, with three repairs that make a second integration (the user's own iTerm2
//! one, say) harmless: a prompt drawn again on its row is one prompt, a command ends only after it started, and a
//! repeated start or end counts once.

use std::collections::VecDeque;

use ghostty_vt_sys as sys;

use crate::grid::{SCREEN, TrackedRow, format_rows, wraps};
use crate::{CommandStep, VtError};

/// The most marks kept, three per command (its prompt, its output and its end); the oldest go first.
const MAX_MARKS: usize = 3_000;

/// The marks of a terminal's commands, oldest first.
pub(crate) struct Marks {
    log: VecDeque<Mark>,
}

struct Mark {
    step: CommandStep,
    row: TrackedRow,
}

impl Marks {
    /// No marks.
    pub(crate) fn new() -> Self {
        Self { log: VecDeque::new() }
    }

    /// Takes a step reported at `row` ([`SCREEN`] coordinates) of `terminal`, and says whether it is a new step of a
    /// command rather than a repeat. The prompt, output, end and bookmarks are kept with their row; the input start is
    /// not, as it shares the prompt's. A prompt after a prompt where no command ran, as an empty Return or Ctrl+C
    /// leaves, takes that one's place, so empty prompts never push commands out of the log.
    pub(crate) fn accept(&mut self, terminal: sys::GhosttyTerminal, step: CommandStep, row: u32) -> bool {
        let last = self.log.back().map(|mark| (mark.step, mark.row.y()));
        let accepted = match step {
            CommandStep::Prompt => last != Some((CommandStep::Prompt, Some(row))),
            CommandStep::Bookmark => last != Some((CommandStep::Bookmark, Some(row))),
            CommandStep::Input => matches!(last, Some((CommandStep::Prompt, _))),
            CommandStep::Output => !matches!(last, Some((CommandStep::Output, _))),
            CommandStep::End { .. } => matches!(last, Some((CommandStep::Output, _))),
        };
        if !accepted || step == CommandStep::Input {
            return accepted;
        }
        if step == CommandStep::Prompt && matches!(last, Some((CommandStep::Prompt, _))) {
            self.log.pop_back();
        }
        self.keep(terminal, step, row)
    }

    /// The steps marked on rows `first..=last`, by row and then in the order they came. Marks come in row order and
    /// rows keep it as output moves them, and pruning takes the oldest first, so a search finds the first one.
    pub(crate) fn in_rows(&self, first: u32, last: u32) -> Vec<(u32, CommandStep)> {
        let start = self.log.partition_point(|mark| mark.row.y().is_none_or(|y| y < first));
        let mut marked: Vec<(u32, CommandStep)> = self
            .log
            .range(start..)
            .filter_map(|mark| mark.row.y().map(|y| (y, mark.step)))
            .take_while(|(y, _)| *y <= last)
            .collect();
        marked.sort_by_key(|(y, _)| *y);
        marked
    }

    /// Keeps `step` on `row`; false when the row can't be tracked, so the step is not reported either.
    fn keep(&mut self, terminal: sys::GhosttyTerminal, step: CommandStep, row: u32) -> bool {
        let Ok(tracked) = TrackedRow::new(terminal, row) else {
            return false;
        };
        if self.log.len() == MAX_MARKS {
            self.log.pop_front();
        }
        self.log.push_back(Mark { step, row: tracked });
        true
    }
}

/// The OSC 133 sequence that marks `step`, or iTerm2's `SetMark` for a bookmark.
pub(crate) fn sequence(step: CommandStep) -> Vec<u8> {
    let mark = match step {
        CommandStep::Bookmark => return b"\x1b]1337;SetMark\x07".to_vec(),
        CommandStep::Prompt => "A".to_owned(),
        CommandStep::Input => "B".to_owned(),
        CommandStep::Output => "C".to_owned(),
        CommandStep::End { exit_code: Some(code) } => format!("D;{code}"),
        CommandStep::End { exit_code: None } => "D".to_owned(),
    };
    format!("\x1b]133;{mark}\x07").into_bytes()
}

/// Formats rows `first..=last` ([`SCREEN`] coordinates) as VT output, each mark written just before the row it
/// marks; as [`format_rows`] does, the last row ends without a line break.
pub(crate) fn format_marked(
    terminal: sys::GhosttyTerminal,
    marks: &Marks,
    first: u32,
    last: u32,
) -> Result<Vec<u8>, VtError> {
    let mut out = Vec::new();
    let mut from = first;
    for (row, step) in marks.in_rows(first, last) {
        if row > from {
            out.extend(format_rows(terminal, SCREEN, from, row - 1, 0)?);
            if !wraps(terminal, SCREEN, row - 1)? {
                out.extend_from_slice(b"\r\n");
            }
            from = row;
        }
        out.extend(sequence(step));
    }
    out.extend(format_rows(terminal, SCREEN, from, last, 0)?);
    Ok(out)
}

/// The marks on the screen, below `history` rows of history and `height` rows high, each written at the start of its
/// row, then the cursor moved back to `cursor` (column, row): a snapshot's screen is formatted whole, with the modes
/// and cursor that recreate it, so its marks follow it.
pub(crate) fn screen_marks(marks: &Marks, history: u32, height: u16, cursor: (u16, u16)) -> Vec<u8> {
    let last = history + u32::from(height.max(1)) - 1;
    let marked = marks.in_rows(history, last);
    if marked.is_empty() {
        return Vec::new();
    }
    let mut out = Vec::new();
    for (row, step) in marked {
        out.extend(format!("\x1b[{};1H", row - history + 1).into_bytes());
        out.extend(sequence(step));
    }
    out.extend(format!("\x1b[{};{}H", cursor.1 + 1, cursor.0 + 1).into_bytes());
    out
}

#[cfg(test)]
pub(crate) mod tests {
    use crate::{CommandStep, GhosttyTerminal, Rgb, TerminalConfig, TerminalEvent, TerminalSize, TerminalState};

    fn terminal(scrollback_lines: usize) -> GhosttyTerminal {
        GhosttyTerminal::new(&TerminalConfig {
            size: TerminalSize { cols: 40, rows: 5 },
            scrollback_lines,
            xtversion: "trcd test".into(),
            foreground: Rgb(1, 1, 1),
            background: Rgb(0, 0, 0),
        })
        .unwrap()
    }

    /// A prompt, then a command whose output is `lines` lines, ending with `code`.
    pub(crate) fn command(name: &str, lines: u32, code: i32) -> Vec<u8> {
        let mut bytes = format!("\x1b]133;A\x07$ \x1b]133;B\x07{name}\r\n\x1b]133;C\x07").into_bytes();
        for line in 0..lines {
            bytes.extend(format!("{name} {line}\r\n").into_bytes());
        }
        bytes.extend(format!("\x1b]133;D;{code}\x07").into_bytes());
        bytes
    }

    fn steps(events: &[TerminalEvent]) -> Vec<CommandStep> {
        events
            .iter()
            .filter_map(|event| match event {
                TerminalEvent::Command(step) => Some(*step),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn keeps_each_mark_on_its_row_as_output_scrolls_it() {
        let mut term = terminal(1_000);
        term.feed(&command("build", 3, 0));
        term.feed(&command("test", 20, 2));
        term.feed(b"\x1b]133;A\x07$ ");
        let marked = term.marks().in_rows(0, u32::MAX);
        assert_eq!(
            marked,
            [
                (0, CommandStep::Prompt),
                (1, CommandStep::Output),
                (4, CommandStep::End { exit_code: Some(0) }),
                (4, CommandStep::Prompt),
                (5, CommandStep::Output),
                (25, CommandStep::End { exit_code: Some(2) }),
                (25, CommandStep::Prompt),
            ]
        );
    }

    #[test]
    fn counts_a_redrawn_prompt_and_repeated_starts_and_ends_once() {
        let mut term = terminal(1_000);
        let events = term.feed(
            b"\x1b]133;A\x07\x1b]133;A\x07$ \x1b]133;D;1\x07\x1b]133;B\x07ls\r\n\x1b]133;C\x07\x1b]133;C\x07a\r\n\x1b]133;D;0\x07\x1b]133;D;0\x07",
        );
        assert_eq!(
            steps(&events),
            [
                CommandStep::Prompt,
                CommandStep::Input,
                CommandStep::Output,
                CommandStep::End { exit_code: Some(0) },
            ]
        );
    }

    #[test]
    fn lets_a_prompt_take_the_place_of_one_where_no_command_ran() {
        let mut term = terminal(10_000);
        term.feed(&command("build", 1, 0));
        term.feed(&"\x1b]133;A\x07$ \r\n".repeat(super::MAX_MARKS + 500).into_bytes());
        term.feed(b"\x1b]133;A\x07$ ");
        let marked = term.marks().in_rows(0, u32::MAX);
        assert_eq!(marked.len(), 4, "{marked:?}");
        assert_eq!(marked[0].1, CommandStep::Prompt);
        assert_eq!(marked[2].1, CommandStep::End { exit_code: Some(0) });
    }

    #[test]
    fn marks_nothing_on_the_alternate_screen_and_keeps_a_bookmark_as_one() {
        let mut term = terminal(1_000);
        term.feed(b"\x1b[?1049h\x1b]133;A\x07$ vim\r\n\x1b]133;C\x07\x1b[?1049l");
        assert_eq!(term.marks().in_rows(0, u32::MAX), []);
        term.feed(b"\x1b]1337;SetMark\x07\x1b]1337;SetMark\x07note\r\n");
        assert_eq!(term.marks().in_rows(0, u32::MAX).len(), 1);
    }

    #[test]
    fn takes_each_marks_row_before_later_output_in_the_same_chunk_moves_it() {
        let mut term = terminal(100);
        term.feed(&"filler\r\n".repeat(300).into_bytes());
        let mut chunk = b"\x1b]133;A\x07$ make\r\n\x1b]133;C\x07".to_vec();
        chunk.extend("out\r\n".repeat(200).into_bytes());
        chunk.extend(b"\x1b]133;D;0\x07\x1b]133;A\x07$ ");
        term.feed(&chunk);
        let rows: Vec<u32> = term.marks().in_rows(0, u32::MAX).iter().map(|(row, _)| *row).collect();
        let text = term.plain_text().unwrap();
        let prompt_rows: Vec<usize> = text
            .lines()
            .enumerate()
            .filter(|(_, line)| line.starts_with('$'))
            .map(|(index, _)| index)
            .collect();
        assert_eq!(
            rows.last().copied(),
            prompt_rows.last().and_then(|row| u32::try_from(*row).ok()),
            "{rows:?}"
        );
    }

    #[test]
    fn forgets_the_marks_of_rows_the_scrollback_dropped() {
        let mut term = terminal(100);
        term.feed(&command("old", 1, 0));
        term.feed(&"filler\r\n".repeat(3_000).into_bytes());
        term.feed(&command("new", 1, 4));
        let marked = term.marks().in_rows(0, u32::MAX);
        assert_eq!(marked.len(), 3, "{marked:?}");
        assert_eq!(marked[2].1, CommandStep::End { exit_code: Some(4) });
    }

    #[test]
    fn follows_its_rows_when_a_resize_reflows_them() {
        let mut term = terminal(1_000);
        term.feed(&format!("{}\r\n", "x".repeat(70)).into_bytes());
        term.feed(&command("after", 1, 0));
        assert_eq!(term.marks().in_rows(0, u32::MAX)[0], (2, CommandStep::Prompt));
        term.resize(TerminalSize { cols: 80, rows: 5 }).unwrap();
        assert_eq!(term.marks().in_rows(0, u32::MAX)[0], (1, CommandStep::Prompt));
    }
}
