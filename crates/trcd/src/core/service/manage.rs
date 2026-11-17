//! Managing the daemon from the app (US-3.3.2, US-3.3.3): Restart daemon ends only the core, whose successor adopts
//! every holder, and Remove daemon stops every session, deletes the saved sessions and ends the core.

use std::time::Duration;

use trc_protocol::{ErrorCode, ServerMessage};

use super::requests::error;
use super::{ClientId, Core};
use crate::holder::protocol::HolderCommand;

/// How long an exiting core waits, in all, for its last replies to reach the apps.
const FLUSH_TIMEOUT: Duration = Duration::from_secs(2);

impl Core {
    /// Answers `restartDaemon`, then stops serving: the holders keep running, and the next bridge starts a core that
    /// adopts them (US-3.3.2).
    pub(super) fn restart_daemon(&mut self, request_id: u32) -> ServerMessage {
        tracing::info!("restarting the core, as an app asked");
        self.exiting = true;
        ServerMessage::Done { request_id }
    }

    /// Starts removing the daemon: every session stops, with `grace_ms` between the stop signals, and closes. The
    /// answer comes once the last one has closed and the saved sessions are deleted (US-3.3.3).
    pub(super) fn remove_daemon(
        &mut self,
        client: ClientId,
        request_id: u32,
        grace_ms: Option<u32>,
    ) -> Option<ServerMessage> {
        if self.removal.is_some() {
            return Some(error(
                Some(request_id),
                ErrorCode::BadRequest,
                "the daemon is already being removed",
            ));
        }
        tracing::info!(
            sessions = self.registry.ids().len(),
            "removing the daemon, as an app asked"
        );
        self.removal = Some((client, request_id));
        for session in self.registry.ids() {
            if let Some(record) = self.registry.get_mut(&session) {
                record.closing = true;
            }
            self.persist(&session);
            let stopping = self.holder_command(&session, &HolderCommand::Stop { grace_ms })
                && self.holder_command(&session, &HolderCommand::Shutdown);
            if !stopping {
                self.forget(&session);
            }
        }
        self.forgot_during_removal();
        None
    }

    /// Finishes a removal once no session is left: deletes the saved sessions, answers, and stops serving.
    pub(super) fn forgot_during_removal(&mut self) {
        let Some((client, request_id)) = self.removal.filter(|_| self.registry.ids().is_empty()) else {
            return;
        };
        self.removal = None;
        let reply = match self.context.store.remove_all() {
            Ok(()) => ServerMessage::Done { request_id },
            Err(problem) => {
                tracing::warn!(error = %problem, "the saved sessions could not be deleted");
                error(
                    Some(request_id),
                    ErrorCode::Internal,
                    "the saved sessions could not be deleted",
                )
            }
        };
        self.reply(client, &reply);
        self.exiting = true;
    }

    /// Lets every app receive what was queued for it, then removes the core's socket, so the next bridge starts a
    /// new core instead of reaching this one.
    pub(super) async fn finish(&mut self) {
        let writers: Vec<_> = std::mem::take(&mut self.clients)
            .into_values()
            .map(|link| link.writer)
            .collect();
        let deadline = tokio::time::Instant::now() + FLUSH_TIMEOUT;
        for writer in writers {
            let _ = tokio::time::timeout_at(deadline, writer).await;
        }
        self.context.store.flush();
        let _ = std::fs::remove_file(self.context.run.core_socket());
        tracing::info!("core stopped");
    }
}
