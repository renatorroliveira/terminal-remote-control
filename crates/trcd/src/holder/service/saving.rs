//! Saving the session to disk (US-3.1.2, US-3.2, NFR-08): starting and stopping it with "Save scrollback to disk",
//! the periodic save and its failures in the status, and Clear scrollback.

use std::path::Path;

use tokio::time::Instant;
use trc_protocol::SessionOptions;
use trc_vt::TerminalState;

use super::Holder;
use crate::holder::persistence::Persistence;

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

    /// Clears the scrollback for every client, as output, and rewrites the file without it (US-3.2.3).
    pub(super) fn clear_scrollback(&mut self) {
        if let Some(terminal) = &mut self.terminal {
            terminal.feed(CLEAR_SCROLLBACK);
        }
        self.log.push(CLEAR_SCROLLBACK);
        self.attachments.push(CLEAR_SCROLLBACK);
        if let Some(persistence) = &mut self.persistence {
            persistence.rewrite();
            persistence.output();
        }
    }
}
