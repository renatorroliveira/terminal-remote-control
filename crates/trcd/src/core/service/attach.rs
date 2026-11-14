//! Attachments: any number of clients per session (US-2.6.1), each on its own stream, routed to the holder's
//! attachment of the same identifier. A holder protocol 1 session (an E1 holder) serves one client at a time, as E1 did.

use trc_protocol::frame::{self, CREDIT_WINDOW, FrameKind};
use trc_protocol::{ErrorCode, Replay, ServerMessage, SessionId};

use super::requests::error;
use super::{Attachment, ClientId, Core, Route};
use crate::holder::protocol::{HolderCommand, HolderEvent, SESSION_STREAM};

impl Core {
    /// Attaches a client to a session's output. A protocol 2 holder answers when it knows whether it replays the
    /// missed output or a snapshot, so the reply comes then; an E1 holder's answer is immediate.
    pub(super) fn attach(
        &mut self,
        client: ClientId,
        request_id: u32,
        session: &SessionId,
        from_offset: Option<u64>,
    ) -> Option<ServerMessage> {
        let proto = self.clients.get(&client)?.proto;
        self.detach_client(client, session);
        let holder_proto = self.holders.get(session)?.proto;
        let id = self.next_attachment(session, holder_proto);
        let stream = self.open_stream(client, session, id)?;
        if holder_proto < 2 {
            self.detach_all(session);
            self.add_attachment(session, id, client, stream, None);
            self.holder_command(session, &legacy_attach());
            return Some(attached(
                request_id,
                session,
                stream,
                (proto >= 2).then_some(Replay::Snapshot),
            ));
        }
        self.add_attachment(session, id, client, stream, Some(request_id));
        self.holder_command(
            session,
            &HolderCommand::Attach {
                credit: CREDIT_WINDOW,
                attachment: Some(id),
                from_offset,
                legacy: proto < 2,
            },
        );
        None
    }

    /// Detaches a client from a session; the session keeps running.
    pub(super) fn detach(&mut self, client: ClientId, request_id: u32, session: &SessionId) -> ServerMessage {
        self.detach_client(client, session);
        ServerMessage::Done { request_id }
    }

    /// Asks the holder for a client's whole scrollback and screen again (D-45).
    pub(super) fn refresh(&mut self, client: ClientId, request_id: u32, session: &SessionId) -> ServerMessage {
        let route = self
            .clients
            .get(&client)
            .and_then(|link| link.streams.values().find(|route| &route.session == session).cloned());
        let Some(route) = route else {
            return error(Some(request_id), ErrorCode::BadRequest, "the session is not attached");
        };
        if self.holders.get(session).is_none_or(|holder| holder.proto < 2) {
            return error(
                Some(request_id),
                ErrorCode::Unsupported,
                "this session's holder cannot refresh",
            );
        }
        self.holder_command(
            session,
            &HolderCommand::Refresh {
                attachment: route.attachment,
            },
        );
        ServerMessage::Done { request_id }
    }

    /// Ends every attachment of a client that went away.
    pub(super) fn detach_streams(&mut self, client: ClientId, routes: impl IntoIterator<Item = Route>) {
        for route in routes {
            self.end_attachment(&route.session, route.attachment, client);
        }
    }

    /// Passes typed input on to the holder, as the client's attachment (INPUT never waits, NFR-03).
    pub(super) fn forward_input(&mut self, client: ClientId, stream: u32, payload: &[u8]) {
        if let Some(route) = self.route(client, stream)
            && let Ok(encoded) = frame::encode(FrameKind::Input, route.attachment, payload)
        {
            self.send_to_holder(&route.session, encoded);
        }
    }

    /// Passes output credit on to the holder, for the client's attachment.
    pub(super) fn forward_credit(&mut self, client: ClientId, stream: u32, payload: &[u8]) {
        if let Some(route) = self.route(client, stream)
            && let Some(bytes) = payload.first_chunk::<4>()
        {
            self.send_to_holder(
                &route.session,
                frame::encode_credit(route.attachment, u32::from_be_bytes(*bytes)),
            );
        }
    }

    /// Sends a holder's output to the client of the attachment it belongs to.
    pub(super) fn route_output(&self, session: &SessionId, attachment: u32, payload: &[u8]) {
        if let Some(target) = self
            .holders
            .get(session)
            .and_then(|holder| holder.attachments.get(&attachment))
            && let Some(link) = self.clients.get(&target.client)
            && let Ok(encoded) = frame::encode(FrameKind::Output, target.stream, payload)
        {
            link.sender.send(encoded);
        }
    }

    /// Turns a holder's attachment event into the client's message: the delayed `attached` reply, or `synced`,
    /// `resync` and `peerInput`, which only protocol 2 clients get.
    pub(super) fn on_attachment_event(&mut self, session: &SessionId, event: HolderEvent) {
        let Some((attachment, message)) = attachment_message(session, event) else {
            return;
        };
        let Some(target) = self
            .holders
            .get_mut(session)
            .and_then(|holder| holder.attachments.get_mut(&attachment))
        else {
            return;
        };
        let request = target.request.take();
        let (client, stream) = (target.client, target.stream);
        let proto = self.clients.get(&client).map_or(1, |link| link.proto);
        let reply = match message {
            ServerMessage::Attached { replay, .. } => {
                let Some(request_id) = request else {
                    return;
                };
                attached(request_id, session, stream, replay.filter(|_| proto >= 2))
            }
            other if proto >= 2 => with_stream(other, stream),
            _ => return,
        };
        self.reply(client, &reply);
    }

    /// Ends every attachment of a session whose holder is gone; a client still waiting to attach is told.
    pub(super) fn drop_attachments(&mut self, session: &SessionId) {
        let attachments = self
            .holders
            .get_mut(session)
            .map(|holder| std::mem::take(&mut holder.attachments))
            .unwrap_or_default();
        for target in attachments.into_values() {
            if let Some(link) = self.clients.get_mut(&target.client) {
                link.streams.remove(&target.stream);
            }
            if let Some(request_id) = target.request {
                self.reply(
                    target.client,
                    &error(Some(request_id), ErrorCode::UnknownSession, "the session ended"),
                );
            }
        }
    }

    fn route(&self, client: ClientId, stream: u32) -> Option<Route> {
        self.clients.get(&client)?.streams.get(&stream).cloned()
    }

    fn next_attachment(&mut self, session: &SessionId, holder_proto: u32) -> u32 {
        let Some(holder) = self.holders.get_mut(session) else {
            return SESSION_STREAM;
        };
        if holder_proto < 2 {
            return SESSION_STREAM;
        }
        let id = holder.next_attachment;
        holder.next_attachment = holder.next_attachment.wrapping_add(1).max(1);
        id
    }

    fn open_stream(&mut self, client: ClientId, session: &SessionId, attachment: u32) -> Option<u32> {
        let link = self.clients.get_mut(&client)?;
        let stream = link.next_stream;
        link.next_stream += 1;
        link.streams.insert(
            stream,
            Route {
                session: session.clone(),
                attachment,
            },
        );
        Some(stream)
    }

    fn add_attachment(&mut self, session: &SessionId, id: u32, client: ClientId, stream: u32, request: Option<u32>) {
        if let Some(holder) = self.holders.get_mut(session) {
            holder.attachments.insert(
                id,
                Attachment {
                    client,
                    stream,
                    request,
                },
            );
        }
    }

    /// Ends the client's attachment to a session, if it has one.
    fn detach_client(&mut self, client: ClientId, session: &SessionId) {
        let routes: Vec<(u32, Route)> = self
            .clients
            .get(&client)
            .map(|link| {
                link.streams
                    .iter()
                    .filter(|(_, route)| &route.session == session)
                    .map(|(stream, route)| (*stream, route.clone()))
                    .collect()
            })
            .unwrap_or_default();
        for (stream, route) in routes {
            if let Some(link) = self.clients.get_mut(&client) {
                link.streams.remove(&stream);
            }
            self.end_attachment(session, route.attachment, client);
        }
    }

    /// An E1 holder serves one client: a new attachment replaces whoever was attached.
    fn detach_all(&mut self, session: &SessionId) {
        let attachments = self
            .holders
            .get_mut(session)
            .map(|holder| std::mem::take(&mut holder.attachments))
            .unwrap_or_default();
        for target in attachments.into_values() {
            if let Some(link) = self.clients.get_mut(&target.client) {
                link.streams.remove(&target.stream);
            }
        }
    }

    fn end_attachment(&mut self, session: &SessionId, attachment: u32, client: ClientId) {
        let Some(holder) = self.holders.get_mut(session) else {
            return;
        };
        if holder
            .attachments
            .get(&attachment)
            .is_none_or(|target| target.client != client)
        {
            return;
        }
        holder.attachments.remove(&attachment);
        let command = if holder.proto < 2 {
            HolderCommand::Detach { attachment: None }
        } else {
            HolderCommand::Detach {
                attachment: Some(attachment),
            }
        };
        self.holder_command(session, &command);
    }
}

fn legacy_attach() -> HolderCommand {
    HolderCommand::Attach {
        credit: CREDIT_WINDOW,
        attachment: None,
        from_offset: None,
        legacy: false,
    }
}

fn attached(request_id: u32, session: &SessionId, stream: u32, replay: Option<Replay>) -> ServerMessage {
    ServerMessage::Attached {
        request_id,
        session: session.clone(),
        stream,
        credit: CREDIT_WINDOW,
        replay,
    }
}

/// The attachment an event is about, and the client message it becomes, with the stream filled in later.
fn attachment_message(session: &SessionId, event: HolderEvent) -> Option<(u32, ServerMessage)> {
    let session = session.clone();
    match event {
        HolderEvent::Attached { attachment, replay } => Some((
            attachment,
            ServerMessage::Attached {
                request_id: 0,
                session,
                stream: 0,
                credit: CREDIT_WINDOW,
                replay: Some(replay),
            },
        )),
        HolderEvent::Synced { attachment, offset } => Some((
            attachment,
            ServerMessage::Synced {
                session,
                stream: 0,
                offset,
            },
        )),
        HolderEvent::Resync { attachment, kind } => Some((
            attachment,
            ServerMessage::Resync {
                session,
                stream: 0,
                kind,
            },
        )),
        HolderEvent::PeerInput { attachment } => Some((attachment, ServerMessage::PeerInput { session, stream: 0 })),
        _ => None,
    }
}

fn with_stream(message: ServerMessage, stream: u32) -> ServerMessage {
    match message {
        ServerMessage::Synced { session, offset, .. } => ServerMessage::Synced {
            session,
            stream,
            offset,
        },
        ServerMessage::Resync { session, kind, .. } => ServerMessage::Resync { session, stream, kind },
        ServerMessage::PeerInput { session, .. } => ServerMessage::PeerInput { session, stream },
        other => other,
    }
}
