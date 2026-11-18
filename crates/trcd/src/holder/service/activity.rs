//! What the session did that the app may announce (US-5.2.2, US-5.3): each command shell integration marks, with its
//! exit code and how long it ran, and the bell, at most once a second; and whether the shell marks its commands
//! itself (US-5.2.3).

use std::time::Duration;

use tokio::time::Instant;
use trc_protocol::ShellIntegration;
use trc_vt::CommandStep;

use super::Holder;
use crate::holder::protocol::HolderEvent;

/// The shortest time between two bells the holder reports.
const BELL_INTERVAL: Duration = Duration::from_secs(1);

/// When the running command started and when a bell was last reported.
#[derive(Debug, Default)]
pub(super) struct Activity {
    command_started: Option<Instant>,
    last_bell: Option<Instant>,
}

impl Holder {
    /// Takes a step shell integration marked: a command's start starts its clock, and its end is reported with its
    /// exit code and how long it ran. Marks from a shell TRC did not inject say it marks commands itself.
    pub(super) fn on_command_step(&mut self, step: CommandStep) {
        self.note_native_integration();
        match step {
            CommandStep::Output => self.activity.command_started = Some(Instant::now()),
            CommandStep::End { exit_code } => {
                if let Some(started) = self.activity.command_started.take() {
                    let duration_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
                    self.send_event(&HolderEvent::CommandFinished { exit_code, duration_ms });
                }
            }
            CommandStep::Prompt | CommandStep::Input => {}
        }
    }

    /// Reports the bell, unless one was reported less than a second ago.
    pub(super) fn on_bell(&mut self) {
        let now = Instant::now();
        if self
            .activity
            .last_bell
            .is_some_and(|last| now.duration_since(last) < BELL_INTERVAL)
        {
            return;
        }
        self.activity.last_bell = Some(now);
        self.send_event(&HolderEvent::Bell);
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
