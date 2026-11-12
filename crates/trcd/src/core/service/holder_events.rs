//! Holder connections: queued commands flushed on connect, output routed to the attached app, status turned into
//! session events, and the end of a holder (US-1.9.4).

use tokio::net::UnixStream;
use trc_protocol::frame::{self, Frame, FrameKind};
use trc_protocol::{ServerMessage, SessionChange, SessionId, SessionState};

use super::Core;
use crate::frame_io::{FrameReader, FrameSender};
use crate::holder::protocol::HolderEvent;

impl Core {
    pub(super) fn on_holder_connected(&mut self, session: &SessionId, stream: UnixStream) {
        let Some(link) = self.holders.get_mut(session) else {
            return;
        };
        let (read, write) = stream.into_split();
        let (sender, _writer) = FrameSender::spawn(write);
        for frame in link.pending.drain(..) {
            sender.send(frame);
        }
        link.sender = Some(sender);
        self.spawn_holder_reader(session.clone(), FrameReader::new(read));
    }

    pub(super) fn on_holder_failed(&mut self, session: &SessionId, reason: &str) {
        self.holders.remove(session);
        tracing::warn!(session = %session.0, error = reason, "holder failed to start");
        let Some(record) = self.registry.get_mut(session) else {
            return;
        };
        if record.closing {
            return self.forget(session);
        }
        record.info.state = SessionState::FailedToStart;
        record.info.failure = Some(format!("the session process could not start: {reason}"));
        let info = record.info.clone();
        self.broadcast(&ServerMessage::SessionEvent {
            change: SessionChange::Updated { session: info },
        });
    }

    pub(super) fn on_holder_frame(&mut self, session: &SessionId, frame: &Frame) {
        match frame.kind {
            FrameKind::Output => self.route_output(session, &frame.payload),
            FrameKind::Control => self.on_holder_event(session, &frame.payload),
            _ => {}
        }
    }

    pub(super) fn on_holder_closed(&mut self, session: &SessionId) {
        self.holders.remove(session);
        let Some(record) = self.registry.get_mut(session) else {
            return;
        };
        if record.closing {
            return self.forget(session);
        }
        self.detach_session(session);
        let _ = std::fs::remove_file(self.context.run.holder_socket(session));
        let Some(record) = self.registry.get_mut(session) else {
            return;
        };
        if matches!(record.info.state, SessionState::Starting | SessionState::Running) {
            record.info.state = SessionState::Exited;
            record.info.failure = Some("the session's holder process ended".into());
        }
        record.info.pid = None;
        let info = record.info.clone();
        tracing::warn!(session = %session.0, "holder ended");
        self.broadcast(&ServerMessage::SessionEvent {
            change: SessionChange::Updated { session: info },
        });
    }

    fn route_output(&self, session: &SessionId, payload: &[u8]) {
        if let Some(attachment) = self.attachments.get(session)
            && let Some(link) = self.clients.get(&attachment.client)
            && let Ok(encoded) = frame::encode(FrameKind::Output, attachment.stream, payload)
        {
            link.sender.send(encoded);
        }
    }

    fn on_holder_event(&mut self, session: &SessionId, payload: &[u8]) {
        if let Ok(HolderEvent::Status { status }) = serde_json::from_slice(payload)
            && let Some(info) = self.registry.apply_status(session, &status)
        {
            self.broadcast(&ServerMessage::SessionEvent {
                change: SessionChange::Updated { session: info },
            });
        }
    }
}
