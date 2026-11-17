//! Saving the session to disk (US-3.1.2, US-3.2, NFR-08): bringing back what was saved, starting and stopping
//! saving with "Save scrollback to disk", the periodic save and its failures in the status, and Clear scrollback.

use std::path::Path;

use tokio::time::Instant;
use trc_protocol::SessionOptions;
use trc_vt::{GhosttyTerminal, TerminalState, strip_controls};

use super::Holder;
use crate::holder::persistence::Persistence;
use crate::holder::scrollback_file::{FILE_NAME, read};

/// What clears the scrollback, in the emulator and in every client's terminal alike (ED 3).
const CLEAR_SCROLLBACK: &[u8] = b"\x1b[3J";

impl Holder {
    /// Starts saving when the session's options and data folder allow it; `keep` is how much of the folder's
    /// scrollback file reading trusted.
    pub(super) fn start_saving(&mut self, keep: u64) {
        let Some(spec) = &self.spec else {
            return;
        };
        if let (true, Some(dir)) = (spec.options.save_scrollback, &spec.data_dir) {
            self.persistence = Some(Persistence::start(Path::new(dir), keep, spec.scrollback_lines));
        }
    }

    /// Feeds the terminal the session's saved scrollback and screen, then `lines` below them, and returns how much of
    /// the file reading trusted (US-3.1.4). A session saved nothing has no scrollback to bring back.
    pub(super) fn replay_saved(&mut self, lines: &[String]) -> u64 {
        let dir = self.spec.as_ref().and_then(|spec| spec.data_dir.clone());
        let Some(terminal) = &mut self.terminal else {
            return 0;
        };
        let kept = dir.map_or(0, |dir| replay_file(terminal, &Path::new(&dir).join(FILE_NAME)));
        for line in lines {
            terminal.feed(format!("\x1b[0m{}\r\n", strip_controls(line)).as_bytes());
        }
        kept
    }

    /// Saves what changed since the last save, and reports when saving starts or stops failing.
    pub(super) fn save(&mut self) {
        let (Some(persistence), Some(terminal)) = (&mut self.persistence, &self.terminal) else {
            return;
        };
        persistence.save(terminal, Instant::now());
        let failure = persistence.failure();
        if failure != self.status.persistence_failure {
            self.status.persistence_failure = failure;
            self.send_status();
        }
    }

    /// Takes new options: turning saving off deletes what is on disk at once (P-44), turning it on saves everything.
    pub(super) fn set_options(&mut self, options: SessionOptions) {
        let Some(spec) = &mut self.spec else {
            return;
        };
        let was_saving = spec.options.save_scrollback;
        spec.options = options;
        match (was_saving, options.save_scrollback) {
            (true, false) => {
                if let Some(persistence) = self.persistence.take() {
                    persistence.delete();
                }
                self.status.persistence_failure = None;
                self.send_status();
            }
            (false, true) => self.start_saving(0),
            _ => {}
        }
    }

    /// Clears the scrollback for every client, as output, deletes the file at once and writes it again without it
    /// (US-3.2.3).
    pub(super) fn clear_scrollback(&mut self) {
        if let Some(terminal) = &mut self.terminal {
            terminal.feed(CLEAR_SCROLLBACK);
        }
        self.log.push(CLEAR_SCROLLBACK);
        self.attachments.push(CLEAR_SCROLLBACK);
        if let Some(persistence) = &mut self.persistence {
            persistence.clear();
        }
    }
}

/// Feeds `terminal` the saved file's history in order, then its last screen; returns how many bytes reading trusted.
fn replay_file(terminal: &mut GhosttyTerminal, path: &Path) -> u64 {
    let Ok(file) = std::fs::File::open(path) else {
        return 0;
    };
    match read(std::io::BufReader::new(file), |history| {
        terminal.feed(history);
    }) {
        Ok(recovered) => {
            if recovered.truncated {
                tracing::warn!("the saved scrollback ended in an incomplete record, which was dropped");
            }
            terminal.feed(&recovered.screen.unwrap_or_default());
            recovered.length
        }
        Err(error) => {
            tracing::warn!(%error, "the saved scrollback could not be read");
            0
        }
    }
}
