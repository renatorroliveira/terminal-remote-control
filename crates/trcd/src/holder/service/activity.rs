//! What the session did that the app may announce (US-5.2.2, US-5.3): each command shell integration marks, with its
//! exit code and how long it ran, and the bell, each at most once a second, so output that forges marks or rings
//! without end floods no client (SEC-06); and whether the shell marks its commands itself (US-5.2.3).

use std::time::Duration;

use tokio::time::Instant;
use trc_protocol::ShellIntegration;
use trc_vt::CommandStep;

use super::Holder;
use crate::holder::protocol::HolderEvent;

/// The shortest time between two bells, or two finished commands, the holder reports. A command the app counts as
/// long runs for a second at least, so it is never one held back.
const REPORT_INTERVAL: Duration = Duration::from_secs(1);

/// When the running command started, and when a bell and a finished command were last reported.
#[derive(Debug, Default)]
pub(super) struct Activity {
    command_started: Option<Instant>,
    last_bell: Option<Instant>,
    last_finished: Option<Instant>,
}

impl Holder {
    /// Takes a step shell integration marked: a command's start starts its clock, and its end is reported with its
    /// exit code and how long it ran. Marks from a shell TRC did not inject say it marks commands itself.
    pub(super) fn on_command_step(&mut self, step: CommandStep) {
        self.note_native_integration();
        match step {
            CommandStep::Output => self.activity.command_started = Some(Instant::now()),
            CommandStep::End { exit_code } => self.on_command_end(exit_code),
            CommandStep::Prompt => self.activity.command_started = None,
            CommandStep::Input | CommandStep::Bookmark => {}
        }
    }

    /// Forgets the running command, as its shell is gone and a new one starts: nothing reports it finished.
    pub(super) fn forget_command(&mut self) {
        self.activity.command_started = None;
    }

    /// Reports the bell, unless one was reported less than a second ago.
    pub(super) fn on_bell(&mut self) {
        if due(&mut self.activity.last_bell) {
            self.send_event(&HolderEvent::Bell);
        }
    }

    fn on_command_end(&mut self, exit_code: Option<i32>) {
        let Some(started) = self.activity.command_started.take() else {
            return;
        };
        if due(&mut self.activity.last_finished) {
            let duration_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
            self.send_event(&HolderEvent::CommandFinished { exit_code, duration_ms });
        }
    }

    fn note_native_integration(&mut self) {
        if !matches!(
            self.status.integration,
            Some(ShellIntegration::Injected | ShellIntegration::Native)
        ) {
            self.status.integration = Some(ShellIntegration::Native);
            self.status_dirty = true;
        }
    }
}

/// Whether a report is due, a second or more after the last one, which it then records.
fn due(last: &mut Option<Instant>) -> bool {
    let now = Instant::now();
    if last.is_some_and(|last| now.duration_since(last) < REPORT_INTERVAL) {
        return false;
    }
    *last = Some(now);
    true
}
