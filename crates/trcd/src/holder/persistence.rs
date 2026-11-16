//! What a holder saves of its session as it runs (TECH_STACK §5.5, NFR-08, US-3.1.2). Every [`SAVE_INTERVAL`], the
//! rows that left the screen and, when it changed, the primary screen go to the end of the session's scrollback file.
//! A whole new file replaces it when the session starts or is restored, when what was appended outgrows what a
//! rewrite would write and the scrollback limit, after a resize reflows the history, after Clear scrollback, and to recover from a failed write.

use std::path::Path;
use std::time::Duration;

use tokio::time::Instant;
use trc_protocol::PersistenceFailure;
use trc_vt::{GhosttyTerminal, HistoryRows, HistoryTail, TerminalState, primary_screen};

use super::scrollback_file::{Record, encode};
use super::scrollback_writer::ScrollbackWriter;

/// How often new output is saved: well inside NFR-08's 5 s, with the time a write takes.
pub const SAVE_INTERVAL: Duration = Duration::from_secs(2);
/// History rows per record.
const ROWS_PER_RECORD: u32 = 2_000;
/// Records a rewrite formats per save, so a long history is rewritten over several saves without stalling output.
const RECORDS_PER_SAVE: u32 = 8;
/// Saves a rewrite may take before it catches up with output in one go, so a flood cannot keep it from ending.
const REWRITE_SAVES: u32 = 5;
/// How long after a failed write the holder tries a whole new file again.
const RETRY_AFTER: Duration = Duration::from_secs(10);

/// One session's saving, while "Save scrollback to disk" is on.
pub struct Persistence {
    writer: ScrollbackWriter,
    tail: HistoryTail,
    rewrite: Option<Rewrite>,
    rewrite_wanted: bool,
    screen_changed: bool,
    /// History rows appended since the file was last rewritten.
    appended_rows: u64,
    /// History rows the last rewrite wrote.
    rewritten_rows: u64,
    scrollback_lines: u64,
    retry_at: Option<Instant>,
}

struct Rewrite {
    tail: HistoryTail,
    rows: u64,
    saves: u32,
}

impl Persistence {
    /// Starts saving to the scrollback file in `dir`, beginning with a whole new file of what the terminal holds;
    /// `keep` is how much of the file reading trusted, which stays until the new file replaces it.
    pub fn start(dir: &Path, keep: u64, scrollback_lines: u32) -> Self {
        Self {
            writer: ScrollbackWriter::open(dir, keep),
            tail: HistoryTail::from_start(),
            rewrite: None,
            rewrite_wanted: true,
            screen_changed: true,
            appended_rows: 0,
            rewritten_rows: 0,
            scrollback_lines: u64::from(scrollback_lines.max(1)),
            retry_at: None,
        }
    }

    /// Output arrived: the screen may have changed.
    pub fn output(&mut self) {
        self.screen_changed = true;
    }

    /// Asks for a whole new file at the next save: after a resize reflowed the history, or Clear scrollback.
    pub fn rewrite(&mut self) {
        self.rewrite_wanted = true;
    }

    /// Why the scrollback is not being saved, while it is not.
    pub fn failure(&self) -> Option<PersistenceFailure> {
        self.writer.failure()
    }

    /// Deletes the file, as turning "Save scrollback to disk" off asks (US-3.2.2), once queued writes are done.
    pub fn delete(self) {
        self.writer.delete();
    }

    /// Saves what changed since the last save. Nothing changes on the primary screen while a full-screen program
    /// runs, and libghostty-vt cannot format it then, so saving waits for the program to leave.
    pub fn save(&mut self, terminal: &GhosttyTerminal, now: Instant) {
        if terminal.alternate_screen() {
            return;
        }
        if self.writer.stale() && self.rewrite.is_none() && !self.rewrite_wanted {
            if self.writer.failure().is_some() {
                self.retry(now);
            } else {
                self.rewrite_wanted = true;
            }
        }
        if self.rewrite_wanted && self.rewrite.is_none() {
            self.begin_rewrite();
        }
        if self.rewrite.is_some() {
            self.continue_rewrite(terminal);
        } else {
            self.append(terminal);
        }
    }

    /// A write failed: a whole new file is tried once [`RETRY_AFTER`] has passed.
    fn retry(&mut self, now: Instant) {
        match self.retry_at {
            Some(at) if now >= at => {
                self.retry_at = None;
                self.rewrite_wanted = true;
            }
            Some(_) => {}
            None => self.retry_at = Some(now + RETRY_AFTER),
        }
    }

    fn begin_rewrite(&mut self) {
        self.rewrite_wanted = false;
        self.writer.begin_rewrite();
        self.rewrite = Some(Rewrite {
            tail: HistoryTail::from_start(),
            rows: 0,
            saves: 0,
        });
    }

    /// Formats the next records of the new file; the last holds the screen, and the new file then replaces the old.
    /// After [`REWRITE_SAVES`] saves it takes all the rest at once, which the terminal's own limit bounds.
    fn continue_rewrite(&mut self, terminal: &GhosttyTerminal) {
        let Some(rewrite) = &mut self.rewrite else {
            return;
        };
        rewrite.saves += 1;
        let records = if rewrite.saves >= REWRITE_SAVES {
            u32::MAX
        } else {
            RECORDS_PER_SAVE
        };
        for _ in 0..records {
            let Some(rows) = take(&mut rewrite.tail, terminal) else {
                return self.finish_rewrite(terminal);
            };
            rewrite.rows += u64::from(rows.rows);
            self.writer.rewrite_record(history_record(&rows.bytes, None));
        }
    }

    fn finish_rewrite(&mut self, terminal: &GhosttyTerminal) {
        let Some(rewrite) = self.rewrite.take() else {
            return;
        };
        let screen = screen_of(terminal);
        self.writer.rewrite_record(history_record(&[], screen.as_deref()));
        self.writer.finish_rewrite();
        self.tail = rewrite.tail;
        self.appended_rows = 0;
        self.rewritten_rows = rewrite.rows;
        self.screen_changed = false;
    }

    /// Appends the rows that left the screen since the last save, the screen with the last of them.
    fn append(&mut self, terminal: &GhosttyTerminal) {
        let mut pending = take(&mut self.tail, terminal);
        while let Some(rows) = pending {
            pending = take(&mut self.tail, terminal);
            self.appended_rows += u64::from(rows.rows);
            let screen = if pending.is_none() && self.screen_changed {
                screen_of(terminal)
            } else {
                None
            };
            self.screen_changed &= screen.is_none();
            self.writer.append(history_record(&rows.bytes, screen.as_deref()));
        }
        if self.screen_changed {
            self.screen_changed = false;
            if let Some(screen) = screen_of(terminal) {
                self.writer.append(history_record(&[], Some(&screen)));
            }
        }
        if self.appended_rows > self.scrollback_lines.max(self.rewritten_rows) {
            self.rewrite_wanted = true;
        }
    }
}

/// The next history rows, or `None` when there are none; a terminal that cannot format them is logged.
fn take(tail: &mut HistoryTail, terminal: &GhosttyTerminal) -> Option<HistoryRows> {
    tail.take(terminal, ROWS_PER_RECORD).unwrap_or_else(|error| {
        tracing::warn!(%error, "history rows could not be formatted for the scrollback file");
        None
    })
}

fn screen_of(terminal: &GhosttyTerminal) -> Option<Vec<u8>> {
    primary_screen(terminal).unwrap_or_else(|error| {
        tracing::warn!(%error, "the screen could not be formatted for the scrollback file");
        None
    })
}

fn history_record(history: &[u8], screen: Option<&[u8]>) -> Vec<u8> {
    encode(Record { history, screen })
}

#[cfg(test)]
mod tests {
    use std::fs::File;

    use trc_vt::{Rgb, TerminalConfig, TerminalSize};

    use super::*;
    use crate::holder::scrollback_file::{FILE_NAME, read};
    use crate::test_support::temp_dir;

    fn terminal(scrollback_lines: usize) -> GhosttyTerminal {
        GhosttyTerminal::new(&TerminalConfig {
            size: TerminalSize { cols: 40, rows: 8 },
            scrollback_lines,
            xtversion: "trcd test".into(),
            foreground: Rgb(1, 1, 1),
            background: Rgb(0, 0, 0),
        })
        .unwrap()
    }

    fn lines(from: u32, count: u32) -> Vec<u8> {
        (from..from + count)
            .map(|i| format!("\x1b[1mline\x1b[0m {i}\r\n"))
            .collect::<String>()
            .into_bytes()
    }

    /// What a new terminal shows once fed the file the way a restore feeds it: its history, then its last screen.
    fn restored(dir: &Path, scrollback_lines: usize) -> String {
        let mut replay = terminal(scrollback_lines);
        let file = File::open(dir.join(FILE_NAME)).unwrap();
        let recovered = read(file, |history| {
            replay.feed(history);
        })
        .unwrap();
        replay.feed(&recovered.screen.unwrap_or_default());
        replay.plain_text().unwrap()
    }

    fn saved(live: &mut GhosttyTerminal, persistence: &mut Persistence, output: &[u8]) {
        live.feed(output);
        persistence.output();
        persistence.save(live, Instant::now());
    }

    #[test]
    fn saves_the_history_and_the_screen_so_a_new_terminal_shows_the_same_text() {
        let dir = temp_dir("persist-save");
        let mut live = terminal(1_000);
        let mut persistence = Persistence::start(&dir, 0, 1_000);
        saved(&mut live, &mut persistence, &lines(0, 30));
        for round in 1..4 {
            saved(&mut live, &mut persistence, &lines(round * 30, 30));
        }
        saved(&mut live, &mut persistence, b"$ prompt");
        drop(persistence);
        assert_eq!(restored(&dir, 1_000).trim_end(), live.plain_text().unwrap().trim_end());
    }

    #[test]
    fn rewrites_the_file_once_it_holds_twice_the_scrollback() {
        let dir = temp_dir("persist-compact");
        let mut live = terminal(100);
        let mut persistence = Persistence::start(&dir, 0, 100);
        for round in 0..40 {
            saved(&mut live, &mut persistence, &lines(round * 50, 50));
        }
        drop(persistence);
        let fresh = temp_dir("persist-compact-fresh");
        let mut whole = Persistence::start(&fresh, 0, 100);
        whole.save(&live, Instant::now());
        drop(whole);
        let size = |dir: &Path| std::fs::metadata(dir.join(FILE_NAME)).unwrap().len();
        assert!(
            size(&dir) * 2 <= size(&fresh) * 5,
            "{} bytes, a rewrite {}",
            size(&dir),
            size(&fresh)
        );
        let held = live.plain_text().unwrap();
        let shown = restored(&dir, 100);
        assert!(
            shown.trim_end().ends_with(held.trim_end().lines().last().unwrap()),
            "{shown}"
        );
        assert!(shown.contains("line 1950"), "{shown}");
    }

    #[test]
    fn keeps_the_screen_from_before_a_full_screen_program_while_it_runs() {
        let dir = temp_dir("persist-alternate");
        let mut live = terminal(1_000);
        let mut persistence = Persistence::start(&dir, 0, 1_000);
        saved(&mut live, &mut persistence, &lines(0, 20));
        saved(&mut live, &mut persistence, b"$ vim\r\n\x1b[?1049h\x1b[Hediting");
        saved(&mut live, &mut persistence, b"more editing");
        drop(persistence);
        let shown = restored(&dir, 1_000);
        assert!(shown.contains("line 19"), "{shown}");
        assert!(!shown.contains("editing"), "{shown}");
    }

    #[test]
    fn keeps_only_the_screen_after_clear_scrollback() {
        let dir = temp_dir("persist-clear");
        let mut live = terminal(1_000);
        let mut persistence = Persistence::start(&dir, 0, 1_000);
        saved(&mut live, &mut persistence, &lines(0, 40));
        live.feed(b"\x1b[3J");
        persistence.rewrite();
        saved(&mut live, &mut persistence, b"$ ");
        drop(persistence);
        let shown = restored(&dir, 1_000);
        assert!(!shown.contains("line 0\n"), "{shown}");
        assert!(shown.contains("line 39"), "{shown}");
    }

    #[test]
    fn deletes_what_it_saved() {
        let dir = temp_dir("persist-delete");
        let mut live = terminal(1_000);
        let mut persistence = Persistence::start(&dir, 0, 1_000);
        saved(&mut live, &mut persistence, &lines(0, 40));
        persistence.delete();
        assert!(!dir.join(FILE_NAME).exists());
    }
}
