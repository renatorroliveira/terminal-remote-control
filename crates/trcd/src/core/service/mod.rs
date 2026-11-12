//! The core's event loop: one task owns the registry and routes frames between app connections and holders.
//!
//! Every connection has a reader task that turns frames into [`CoreEvent`]s; writes go through each connection's
//! [`FrameSender`]. Nothing else touches the state, so no locks are needed.

mod holder_events;
mod requests;

use std::collections::BTreeMap;
use std::io;
use std::path::PathBuf;

use rustix::fs::Mode;
use tokio::net::unix::OwnedReadHalf;
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::mpsc;
use trc_protocol::frame::{self, Frame, FrameKind};
use trc_protocol::{ServerMessage, SessionId};

use super::adopt::adopt_holders;
use super::launch::launch_holder;
use super::registry::Registry;
use crate::frame_io::{FrameReader, FrameSender};
use crate::holder::environment::Account;
use crate::holder::protocol::{HolderCommand, HolderSpec};
use crate::peer::is_same_user;
use crate::run_dir::RunDir;

/// How many events may wait for the loop before readers pause.
const EVENT_QUEUE: usize = 256;

/// What the core needs to know about its host and install.
pub struct CoreContext {
    /// The running binary, which holders are started from.
    pub binary: PathBuf,
    /// The binary's SHA-256, reported in `welcome`.
    pub binary_sha256: String,
    /// Where sockets live.
    pub run: RunDir,
    /// The account sessions run as.
    pub account: Account,
    /// The umask the core inherited, which holders and their shells get back.
    pub holder_umask: Mode,
}

/// The core's state and event loop.
pub struct Core {
    context: CoreContext,
    registry: Registry,
    clients: BTreeMap<ClientId, ClientLink>,
    holders: BTreeMap<SessionId, HolderLink>,
    attachments: BTreeMap<SessionId, Attachment>,
    events_tx: mpsc::Sender<CoreEvent>,
    events: mpsc::Receiver<CoreEvent>,
    next_client: ClientId,
}

type ClientId = u64;

struct ClientLink {
    sender: FrameSender,
    greeted: bool,
    streams: BTreeMap<u32, SessionId>,
    next_stream: u32,
}

#[derive(Clone, Copy)]
struct Attachment {
    client: ClientId,
    stream: u32,
}

#[derive(Default)]
struct HolderLink {
    sender: Option<FrameSender>,
    pending: Vec<Vec<u8>>,
}

enum CoreEvent {
    ClientFrame(ClientId, Frame),
    ClientClosed(ClientId),
    HolderConnected(SessionId, UnixStream),
    HolderFailed(SessionId, String),
    HolderFrame(SessionId, Frame),
    HolderClosed(SessionId),
}

impl Core {
    /// Creates a core with no sessions.
    pub fn new(context: CoreContext) -> Self {
        let (events_tx, events) = mpsc::channel(EVENT_QUEUE);
        Self {
            context,
            registry: Registry::default(),
            clients: BTreeMap::new(),
            holders: BTreeMap::new(),
            attachments: BTreeMap::new(),
            events_tx,
            events,
            next_client: 1,
        }
    }

    /// Takes over every live holder a previous core started.
    pub async fn adopt(&mut self) {
        let adopted = adopt_holders(&self.context.run).await;
        tracing::info!(sessions = adopted.len(), "adopted running sessions");
        for found in adopted {
            let id = found.record.info.id.clone();
            self.registry.insert(found.record);
            self.holders.insert(
                id.clone(),
                HolderLink {
                    sender: Some(found.sender),
                    pending: Vec::new(),
                },
            );
            self.spawn_holder_reader(id, found.reader);
        }
    }

    /// Serves app connections on `listener` forever.
    pub async fn serve(mut self, listener: UnixListener) {
        loop {
            tokio::select! {
                accepted = listener.accept() => self.on_accept(accepted.map(|(stream, _)| stream)),
                Some(event) = self.events.recv() => self.on_event(event),
            }
        }
    }

    fn on_accept(&mut self, accepted: io::Result<UnixStream>) {
        let Ok(stream) = accepted else {
            return;
        };
        if !is_same_user(&stream) {
            tracing::warn!("refused a connection from another user");
            return;
        }
        let id = self.next_client;
        self.next_client += 1;
        let (read, write) = stream.into_split();
        let (sender, _writer) = FrameSender::spawn(write);
        self.clients.insert(
            id,
            ClientLink {
                sender,
                greeted: false,
                streams: BTreeMap::new(),
                next_stream: 1,
            },
        );
        self.spawn_client_reader(id, FrameReader::new(read));
        tracing::info!(client = id, "app connected");
    }

    fn on_event(&mut self, event: CoreEvent) {
        match event {
            CoreEvent::ClientFrame(client, frame) => self.on_client_frame(client, frame),
            CoreEvent::ClientClosed(client) => self.on_client_closed(client),
            CoreEvent::HolderConnected(session, stream) => self.on_holder_connected(&session, stream),
            CoreEvent::HolderFailed(session, reason) => self.on_holder_failed(&session, &reason),
            CoreEvent::HolderFrame(session, frame) => self.on_holder_frame(&session, &frame),
            CoreEvent::HolderClosed(session) => self.on_holder_closed(&session),
        }
    }

    fn spawn_client_reader(&self, client: ClientId, mut reader: FrameReader<OwnedReadHalf>) {
        let events = self.events_tx.clone();
        tokio::spawn(async move {
            while let Ok(Some(frame)) = reader.next().await {
                if events.send(CoreEvent::ClientFrame(client, frame)).await.is_err() {
                    return;
                }
            }
            let _ = events.send(CoreEvent::ClientClosed(client)).await;
        });
    }

    fn spawn_holder_reader(&self, session: SessionId, mut reader: FrameReader<OwnedReadHalf>) {
        let events = self.events_tx.clone();
        tokio::spawn(async move {
            while let Ok(Some(frame)) = reader.next().await {
                if events
                    .send(CoreEvent::HolderFrame(session.clone(), frame))
                    .await
                    .is_err()
                {
                    return;
                }
            }
            let _ = events.send(CoreEvent::HolderClosed(session)).await;
        });
    }

    /// Starts a holder for `session`; `start` and the other queued commands reach it once it is connected.
    fn launch(&mut self, session: SessionId, spec: HolderSpec, name: Option<String>) {
        let mut link = HolderLink::default();
        link.pending
            .extend(control_frame(&HolderCommand::Start { spec: Box::new(spec) }));
        if name.is_some() {
            link.pending.extend(control_frame(&HolderCommand::Name { name }));
        }
        self.holders.insert(session.clone(), link);
        let socket = self.context.run.holder_socket(&session);
        let binary = self.context.binary.clone();
        let umask = self.context.holder_umask;
        let events = self.events_tx.clone();
        tokio::spawn(async move {
            let event = match launch_holder(&binary, &socket, umask).await {
                Ok(stream) => CoreEvent::HolderConnected(session, stream),
                Err(error) => CoreEvent::HolderFailed(session, error.to_string()),
            };
            let _ = events.send(event).await;
        });
    }

    /// Sends a frame to a session's holder, queueing it while the holder starts. Returns whether a holder exists.
    fn send_to_holder(&mut self, session: &SessionId, frame: Vec<u8>) -> bool {
        let Some(link) = self.holders.get_mut(session) else {
            return false;
        };
        match &link.sender {
            Some(sender) => {
                sender.send(frame);
            }
            None => link.pending.push(frame),
        }
        true
    }

    fn holder_command(&mut self, session: &SessionId, command: &HolderCommand) -> bool {
        control_frame(command).is_some_and(|frame| self.send_to_holder(session, frame))
    }

    fn reply(&self, client: ClientId, message: &ServerMessage) {
        if let (Some(link), Some(frame)) = (self.clients.get(&client), control_frame(message)) {
            link.sender.send(frame);
        }
    }

    fn broadcast(&self, message: &ServerMessage) {
        let Some(frame) = control_frame(message) else {
            return;
        };
        for link in self.clients.values().filter(|link| link.greeted) {
            link.sender.send(frame.clone());
        }
    }

    fn detach_session(&mut self, session: &SessionId) {
        if let Some(attachment) = self.attachments.remove(session)
            && let Some(link) = self.clients.get_mut(&attachment.client)
        {
            link.streams.remove(&attachment.stream);
        }
    }
}

fn control_frame(message: &impl serde::Serialize) -> Option<Vec<u8>> {
    let payload = serde_json::to_vec(message).ok()?;
    frame::encode(FrameKind::Control, 0, &payload).ok()
}
