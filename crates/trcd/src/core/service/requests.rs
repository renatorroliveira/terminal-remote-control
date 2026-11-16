//! App requests: the handshake, the catalog, the session lifecycle and attachment (US-1.7, US-1.9, US-1.10).

use trc_protocol::frame::{Frame, FrameKind};
use trc_protocol::{
    AttachMode, ClientMessage, CreateSessionSpec, ErrorCode, MIN_PROTOCOL_VERSION, PROTOCOL_VERSION, ServerMessage,
    SessionChange, SessionId, SessionOptions, TerminalSize, negotiate,
};

use super::size::size_problem;
use super::{ClientId, Core};
use crate::core::profiles::detect_profiles;
use crate::core::registry::SessionRecord;
use crate::holder::protocol::{HolderCommand, HolderSpec};
use crate::session_id::new_session_id;

/// The holder protocol that saves sessions to disk.
const SAVING_HOLDER_PROTOCOL: u32 = 3;

/// The scrollback a session gets when the app does not choose one (NFR-10).
const DEFAULT_SCROLLBACK_LINES: u32 = 10_000;
/// The largest scrollback a session may ask for (NFR-10).
const MAX_SCROLLBACK_LINES: u32 = 100_000;

impl Core {
    pub(super) fn on_client_frame(&mut self, client: ClientId, frame: Frame) {
        match frame.kind {
            FrameKind::Control => self.on_client_control(client, &frame.payload),
            FrameKind::Input => self.forward_input(client, frame.stream, &frame.payload),
            FrameKind::Credit => self.forward_credit(client, frame.stream, &frame.payload),
            _ => {}
        }
    }

    pub(super) fn on_client_closed(&mut self, client: ClientId) {
        let Some(link) = self.clients.remove(&client) else {
            return;
        };
        self.detach_streams(client, link.streams.into_values());
        tracing::info!(client, "app disconnected");
    }

    fn on_client_control(&mut self, client: ClientId, payload: &[u8]) {
        let greeted = self.clients.get(&client).is_some_and(|link| link.greeted);
        match (serde_json::from_slice::<ClientMessage>(payload), greeted) {
            (
                Ok(ClientMessage::Hello {
                    min_proto, max_proto, ..
                }),
                false,
            ) => self.on_hello(client, min_proto, max_proto),
            (Ok(message), true) => {
                if let Some(reply) = self.on_request(client, message) {
                    self.reply(client, &reply);
                }
            }
            (_, false) => {
                self.reply(
                    client,
                    &error(None, ErrorCode::BadRequest, "the first message must be hello"),
                );
                self.clients.remove(&client);
            }
            (Err(_), true) => self.reply(client, &error(None, ErrorCode::BadRequest, "malformed message")),
        }
    }

    fn on_hello(&mut self, client: ClientId, min_proto: u32, max_proto: u32) {
        let Some(proto) = negotiate((MIN_PROTOCOL_VERSION, PROTOCOL_VERSION), (min_proto, max_proto)) else {
            self.reply(
                client,
                &ServerMessage::Incompatible {
                    min_proto: MIN_PROTOCOL_VERSION,
                    max_proto: PROTOCOL_VERSION,
                },
            );
            self.clients.remove(&client);
            return;
        };
        if let Some(link) = self.clients.get_mut(&client) {
            link.greeted = true;
            link.proto = proto;
        }
        let welcome = ServerMessage::Welcome {
            proto,
            daemon_version: env!("CARGO_PKG_VERSION").into(),
            binary_sha256: self.context.binary_sha256.clone(),
            caps: Vec::new(),
            service: Some(self.context.service),
            details: Some(self.context.details.clone()),
        };
        self.reply(client, &welcome);
    }

    /// Answers a request; `None` when the answer comes later, as an attach to a protocol 2 holder's does.
    fn on_request(&mut self, client: ClientId, message: ClientMessage) -> Option<ServerMessage> {
        match message {
            ClientMessage::Attach {
                request_id,
                session,
                mode,
                from_offset,
            } => self.attach_request(client, request_id, &session, mode, from_offset),
            ClientMessage::Detach { request_id, session } => Some(self.detach(client, request_id, &session)),
            ClientMessage::Refresh { request_id, session } => Some(self.refresh(client, request_id, &session)),
            other => Some(self.on_simple_request(other)),
        }
    }

    fn on_simple_request(&mut self, message: ClientMessage) -> ServerMessage {
        match message {
            ClientMessage::Hello { .. } => error(None, ErrorCode::BadRequest, "already greeted"),
            ClientMessage::Ping { request_id } => ServerMessage::Pong { request_id },
            ClientMessage::ListSessions { request_id } => ServerMessage::Sessions {
                request_id,
                sessions: self.registry.list(),
            },
            ClientMessage::ListProfiles { request_id } => ServerMessage::Profiles {
                request_id,
                profiles: detect_profiles(&self.context.account.shell),
            },
            ClientMessage::Create { request_id, spec } => self.create(request_id, spec),
            ClientMessage::Rename {
                request_id,
                session,
                name,
            } => self.rename(request_id, &session, name),
            ClientMessage::Reorder {
                request_id,
                session,
                index,
            } => self.reorder(request_id, &session, index),
            ClientMessage::Stop {
                request_id,
                session,
                grace_ms,
            } => self.command_session(request_id, &session, &HolderCommand::Stop { grace_ms }),
            ClientMessage::Restart { request_id, session } => self.restart(request_id, &session),
            ClientMessage::Close { request_id, session } => self.close(request_id, &session),
            ClientMessage::Resize {
                request_id,
                session,
                size,
            } => self.resize(request_id, &session, size),
            ClientMessage::Attach { request_id, .. }
            | ClientMessage::Detach { request_id, .. }
            | ClientMessage::Refresh { request_id, .. } => {
                error(Some(request_id), ErrorCode::Internal, "routed elsewhere")
            }
            ClientMessage::SetSessionOptions {
                request_id,
                session,
                options,
            } => self.set_options(request_id, &session, options),
            ClientMessage::ClearScrollback { request_id, session } => {
                self.saving_command(request_id, &session, &HolderCommand::ClearScrollback)
            }
            ClientMessage::RestartDaemon { request_id } | ClientMessage::RemoveDaemon { request_id, .. } => {
                error(Some(request_id), ErrorCode::Unsupported, "not supported by this daemon")
            }
        }
    }

    fn attach_request(
        &mut self,
        client: ClientId,
        request_id: u32,
        session: &SessionId,
        mode: AttachMode,
        from_offset: Option<u64>,
    ) -> Option<ServerMessage> {
        if self.registry.get(session).is_none() || !self.holders.contains_key(session) {
            return Some(unknown(request_id));
        }
        if mode != AttachMode::Full {
            return Some(error(
                Some(request_id),
                ErrorCode::Unsupported,
                "only full attachment is supported",
            ));
        }
        self.attach(client, request_id, session, from_offset)
    }

    fn create(&mut self, request_id: u32, spec: CreateSessionSpec) -> ServerMessage {
        if let Some(problem) = size_problem(spec.size) {
            return error(Some(request_id), ErrorCode::BadRequest, problem);
        }
        let profiles = detect_profiles(&self.context.account.shell);
        let profile = match &spec.profile_id {
            None => profiles.first(),
            Some(id) => profiles.iter().find(|profile| &profile.id == id),
        };
        let Some(profile) = profile.cloned() else {
            return error(Some(request_id), ErrorCode::BadRequest, "unknown shell profile");
        };
        let cwd = spec
            .cwd
            .or_else(|| profile.cwd.clone())
            .unwrap_or_else(|| self.context.account.home.clone());
        if !cwd.starts_with('/') {
            return error(
                Some(request_id),
                ErrorCode::BadRequest,
                "the working directory must be absolute",
            );
        }
        let Ok(id) = new_session_id() else {
            return error(Some(request_id), ErrorCode::Internal, "no session identifier available");
        };
        let holder_spec = HolderSpec {
            profile,
            cwd: Some(cwd),
            env: spec.env,
            size: spec.size,
            scrollback_lines: spec
                .scrollback_lines
                .unwrap_or(DEFAULT_SCROLLBACK_LINES)
                .min(MAX_SCROLLBACK_LINES),
            home: self.context.account.home.clone(),
            user: self.context.account.user.clone(),
            options: spec.options.unwrap_or_default(),
            data_dir: self.session_data_dir(&id),
        };
        let info = self
            .registry
            .insert(SessionRecord::new(id.clone(), holder_spec.clone(), spec.name.clone()));
        tracing::info!(session = %id.0, "session created");
        self.launch(id.clone(), holder_spec, spec.name, None);
        self.persist(&id);
        self.broadcast(&ServerMessage::SessionEvent {
            change: SessionChange::Created { session: info.clone() },
        });
        ServerMessage::Created {
            request_id,
            session: info,
        }
    }

    fn rename(&mut self, request_id: u32, session: &SessionId, name: Option<String>) -> ServerMessage {
        let Some(info) = self.registry.rename(session, name.clone()) else {
            return unknown(request_id);
        };
        self.holder_command(session, &HolderCommand::Name { name });
        self.persist(session);
        self.broadcast(&ServerMessage::SessionEvent {
            change: SessionChange::Updated { session: info },
        });
        ServerMessage::Done { request_id }
    }

    fn reorder(&mut self, request_id: u32, session: &SessionId, index: u32) -> ServerMessage {
        let Some(order) = self
            .registry
            .reorder(session, usize::try_from(index).unwrap_or(usize::MAX))
        else {
            return unknown(request_id);
        };
        self.persist_all();
        self.broadcast(&ServerMessage::SessionEvent {
            change: SessionChange::Reordered { order },
        });
        ServerMessage::Done { request_id }
    }

    fn command_session(&mut self, request_id: u32, session: &SessionId, command: &HolderCommand) -> ServerMessage {
        if self.registry.get(session).is_none() {
            return unknown(request_id);
        }
        self.holder_command(session, command);
        ServerMessage::Done { request_id }
    }

    fn restart(&mut self, request_id: u32, session: &SessionId) -> ServerMessage {
        let Some(record) = self.registry.get(session) else {
            return unknown(request_id);
        };
        if !self.holders.contains_key(session) {
            let (spec, name) = (record.spec.clone(), record.info.custom_name.clone());
            self.launch(session.clone(), spec, name, None);
            return ServerMessage::Done { request_id };
        }
        self.command_session(request_id, session, &HolderCommand::Restart)
    }

    fn close(&mut self, request_id: u32, session: &SessionId) -> ServerMessage {
        let Some(record) = self.registry.get_mut(session) else {
            return unknown(request_id);
        };
        record.closing = true;
        if !self.holder_command(session, &HolderCommand::Shutdown) {
            self.forget(session);
        }
        ServerMessage::Done { request_id }
    }

    fn resize(&mut self, request_id: u32, session: &SessionId, size: TerminalSize) -> ServerMessage {
        if let Some(problem) = size_problem(size) {
            return error(Some(request_id), ErrorCode::BadRequest, problem);
        }
        self.command_session(request_id, session, &HolderCommand::Resize { size })
    }

    /// Takes a session's new options and tells every app; its holder deletes what is on disk when saving stops.
    fn set_options(&mut self, request_id: u32, session: &SessionId, options: SessionOptions) -> ServerMessage {
        let reply = self.saving_command(request_id, session, &HolderCommand::SetOptions { options });
        let Some(record) = self
            .registry
            .get_mut(session)
            .filter(|_| matches!(reply, ServerMessage::Done { .. }))
        else {
            return reply;
        };
        record.spec.options = options;
        record.info.options = Some(options);
        let info = record.info.clone();
        self.persist(session);
        self.broadcast(&ServerMessage::SessionEvent {
            change: SessionChange::Updated { session: info },
        });
        reply
    }

    /// Sends a command only holders from protocol 3 on understand; an older holder saves nothing to disk.
    fn saving_command(&mut self, request_id: u32, session: &SessionId, command: &HolderCommand) -> ServerMessage {
        match self.holders.get(session).map(|holder| holder.proto) {
            None => unknown(request_id),
            Some(proto) if proto < SAVING_HOLDER_PROTOCOL => error(
                Some(request_id),
                ErrorCode::Unsupported,
                "this session was started by an older daemon",
            ),
            Some(_) => self.command_session(request_id, session, command),
        }
    }

    /// The folder a new session saves its scrollback in, created private (SEC-05.1); none when it cannot be.
    fn session_data_dir(&self, session: &SessionId) -> Option<String> {
        match self.context.store.prepare(session) {
            Ok(dir) => Some(dir.to_string_lossy().into_owned()),
            Err(error) => {
                tracing::warn!(session = %session.0, %error, "the session's data folder could not be created");
                None
            }
        }
    }

    /// Removes a closed session, with its saved data (US-3.2.3), and tells every app.
    pub(super) fn forget(&mut self, session: &SessionId) {
        self.drop_attachments(session);
        if self.registry.remove(session).is_some() {
            let _ = std::fs::remove_file(self.context.run.holder_socket(session));
            self.written.remove(session);
            self.context.store.remove(session);
            tracing::info!(session = %session.0, "session closed");
            self.broadcast(&ServerMessage::SessionEvent {
                change: SessionChange::Closed {
                    session_id: session.clone(),
                },
            });
        }
    }
}

fn unknown(request_id: u32) -> ServerMessage {
    error(Some(request_id), ErrorCode::UnknownSession, "no such session")
}

/// An error reply.
pub(super) fn error(request_id: Option<u32>, code: ErrorCode, message: &str) -> ServerMessage {
    ServerMessage::Error {
        request_id,
        code,
        message: message.into(),
    }
}
