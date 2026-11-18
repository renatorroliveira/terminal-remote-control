//! The core's event loop: one task owns the registry and routes frames between app connections and holders.
//!
//! Every connection has a reader task that turns frames into [`CoreEvent`]s; writes go through each connection's
//! [`FrameSender`]. Nothing else touches the state, so no locks are needed.

mod attach;
mod holder_events;
mod manage;
mod recovery;
mod requests;
mod size;

use std::collections::{BTreeMap, BTreeSet};
use std::io;
use std::path::PathBuf;

use rustix::fs::Mode;
use tokio::net::unix::OwnedReadHalf;
use tokio::net::{UnixListener, UnixStream};
use tokio::signal::unix::{Signal, SignalKind, signal};
use tokio::sync::mpsc;
use trc_protocol::frame::{self, Frame, FrameKind};
use trc_protocol::{DaemonDetails, ServerMessage, ServiceInfo, SessionChange, SessionId, SessionInfo};

use super::adopt::{Adopted, adopt_holders, adopt_late, still_served};
use super::launch::launch_holder;
use super::registry::Registry;
use super::relaunch::EndedHolders;
use super::store::{SessionMeta, SessionStore};
use crate::accept_backoff::AcceptBackoff;
use crate::frame_io::{FrameReader, FrameSender};
use crate::holder::environment::Account;
use crate::holder::protocol::{HOLDER_PROTOCOL, HolderCommand, HolderRestore, HolderSpec};
use crate::peer::is_same_user;
use crate::run_dir::RunDir;
use crate::service::ScopeLauncher;

/// How many events may wait for the loop before readers pause.
const EVENT_QUEUE: usize = 256;

/// Why a core stopped serving.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ending {
    /// An app asked it to restart, or the daemon to be removed.
    Asked,
    /// It got SIGTERM.
    Terminated,
}

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
    /// How the core runs, reported in `welcome` (US-2.4).
    pub service: ServiceInfo,
    /// How holders start in their own scopes when the core runs under systemd.
    pub scope: Option<ScopeLauncher>,
    /// Where the daemon keeps its files and since when it runs, reported in `welcome` (US-3.3.1).
    pub details: DaemonDetails,
    /// Every session's data folder and record, under `<root>/sessions` (TECH_STACK §5.5).
    pub store: SessionStore,
    /// The host's boot ID, which tells a host restart from processes that only ended (P-40).
    pub boot_id: Option<String>,
}

/// The core's state and event loop.
pub struct Core {
    context: CoreContext,
    registry: Registry,
    clients: BTreeMap<ClientId, ClientLink>,
    holders: BTreeMap<SessionId, HolderLink>,
    events_tx: mpsc::Sender<CoreEvent>,
    events: mpsc::Receiver<CoreEvent>,
    next_client: ClientId,
    accepting: AcceptBackoff,
    /// What each session's `meta.json` last received, so unchanged records are not written again.
    written: BTreeMap<SessionId, SessionMeta>,
    /// The `removeDaemon` request waiting for every session to end (US-3.3.3).
    removal: Option<(ClientId, u32)>,
    /// The stop grace period the removal asked for.
    removal_grace: Option<u32>,
    /// Set once the core should stop serving and exit, after a restart or a removal was asked for.
    exiting: bool,
    /// When each session's holder last ended, so one that keeps ending is not brought back again.
    ended_holders: EndedHolders,
}

type ClientId = u64;

struct ClientLink {
    sender: FrameSender,
    /// The task writing `sender`'s frames, awaited when the core exits so its last replies arrive.
    writer: tokio::task::JoinHandle<()>,
    greeted: bool,
    /// The app protocol the client negotiated.
    proto: u32,
    /// Each of the client's streams, and the session attachment it is.
    streams: BTreeMap<u32, Route>,
    next_stream: u32,
}

/// Where a client stream goes: one attachment of one session.
#[derive(Clone)]
struct Route {
    session: SessionId,
    attachment: u32,
}

/// One client attached to a session, on one of its streams.
#[derive(Clone, Copy)]
struct Attachment {
    client: ClientId,
    stream: u32,
    /// The `attach` request still waiting for the holder's answer.
    request: Option<u32>,
}

struct HolderLink {
    sender: Option<FrameSender>,
    pending: Vec<Vec<u8>>,
    /// The holder protocol the holder speaks: 1 for E1 holders, which serve one attachment.
    proto: u32,
    /// The session's attachments, by the identifier the holder knows them by.
    attachments: BTreeMap<u32, Attachment>,
    next_attachment: u32,
}

impl HolderLink {
    fn new(sender: Option<FrameSender>, proto: u32) -> Self {
        Self {
            sender,
            pending: Vec::new(),
            proto,
            attachments: BTreeMap::new(),
            next_attachment: 1,
        }
    }
}

enum CoreEvent {
    ClientFrame(ClientId, Frame),
    ClientClosed(ClientId),
    HolderConnected(SessionId, UnixStream),
    HolderFailed(SessionId, String),
    HolderFrame(SessionId, Frame),
    HolderClosed(SessionId),
    /// A holder that was silent when the core started has introduced itself.
    HolderAdopted(Box<Adopted>),
    /// A holder that was silent when the core started never introduced itself.
    HolderLost(SessionId),
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
            events_tx,
            events,
            next_client: 1,
            accepting: AcceptBackoff::default(),
            written: BTreeMap::new(),
            removal: None,
            removal_grace: None,
            exiting: false,
            ended_holders: EndedHolders::default(),
        }
    }

    /// Takes over every live holder a previous core started.
    pub async fn adopt(&mut self) {
        let adoption = adopt_holders(&self.context.run).await;
        tracing::info!(
            sessions = adoption.adopted.len(),
            waiting = adoption.silent.len(),
            "adopted running sessions"
        );
        let mut live: BTreeSet<SessionId> = adoption.silent.iter().map(|(_, id)| id.clone()).collect();
        for found in adoption.adopted {
            live.insert(self.register_adopted(found).id);
        }
        self.recover_saved(&live);
        for (path, id) in adoption.silent {
            let events = self.events_tx.clone();
            tokio::spawn(async move {
                let event = match adopt_late(&path, &id).await {
                    Some(found) => CoreEvent::HolderAdopted(Box::new(found)),
                    None if !still_served(&path).await => CoreEvent::HolderLost(id),
                    None => {
                        tracing::warn!(session = %id.0, "a live holder never answered; the next core asks it again");
                        return;
                    }
                };
                let _ = events.send(event).await;
            });
        }
    }

    /// Serves app connections on `listener` until an app asks the core to restart or the daemon to be removed, or
    /// the core gets SIGTERM, then delivers what it queued for each app and to disk and returns why it ended, leaving
    /// every holder running (US-3.3.2).
    pub async fn serve(mut self, listener: UnixListener) -> Ending {
        let mut terminate = signal(SignalKind::terminate()).ok();
        let mut ending = Ending::Asked;
        while !self.exiting {
            tokio::select! {
                accepted = listener.accept(), if self.accepting.ready() => {
                    self.on_accept(accepted.map(|(stream, _)| stream));
                }
                () = self.accepting.rested() => self.accepting.resume(),
                Some(event) = self.events.recv() => self.on_event(event),
                () = terminated(terminate.as_mut()) => {
                    tracing::info!("the core got SIGTERM; it ends, and its sessions keep running");
                    self.exiting = true;
                    ending = Ending::Terminated;
                }
            }
        }
        drop(listener);
        self.finish().await;
        ending
    }

    fn on_accept(&mut self, accepted: io::Result<UnixStream>) {
        let Ok(stream) = accepted else {
            self.accepting.failed();
            return;
        };
        if !is_same_user(&stream) {
            tracing::warn!("refused a connection from another user");
            return;
        }
        let id = self.next_client;
        self.next_client += 1;
        let (read, write) = stream.into_split();
        let (sender, writer) = FrameSender::spawn(write);
        self.clients.insert(
            id,
            ClientLink {
                sender,
                writer,
                greeted: false,
                proto: 1,
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
            CoreEvent::HolderAdopted(found) => self.on_late_adoption(*found),
            CoreEvent::HolderLost(session) => self.recover_lost(&session),
        }
    }

    /// Takes over a session whose holder introduced itself late, with what only its record kept, and tells every
    /// app, unless the user had closed it.
    fn on_late_adoption(&mut self, found: Adopted) {
        let id = self.register_adopted(found).id;
        if let Some(meta) = self.context.store.read(&id) {
            self.settle_adopted(&meta);
        }
        if self.removal.is_some() {
            return self.stop_for_removal(&id);
        }
        let Some(record) = self.registry.get(&id).filter(|record| !record.closing) else {
            return;
        };
        let session = record.info.clone();
        self.persist(&id);
        self.broadcast(&ServerMessage::SessionEvent {
            change: SessionChange::Created { session },
        });
    }

    /// Takes over a session from a holder a previous core started.
    fn register_adopted(&mut self, found: Adopted) -> SessionInfo {
        let id = found.record.info.id.clone();
        let info = self.registry.insert(found.record);
        self.holders
            .insert(id.clone(), HolderLink::new(Some(found.sender), found.proto));
        self.spawn_holder_reader(id, found.reader);
        info
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

    /// Starts a holder for `session`, bringing it back from its saved scrollback when `restore` says how;
    /// `start` and the other queued commands reach it once it is connected.
    fn launch(&mut self, session: SessionId, spec: HolderSpec, name: Option<String>, restore: Option<HolderRestore>) {
        let mut link = HolderLink::new(None, HOLDER_PROTOCOL);
        link.pending.extend(control_frame(&HolderCommand::Start {
            spec: Box::new(spec),
            restore: restore.map(Box::new),
        }));
        if name.is_some() {
            link.pending.extend(control_frame(&HolderCommand::Name { name }));
        }
        self.holders.insert(session.clone(), link);
        let socket = self.context.run.holder_socket(&session);
        let binary = self.context.binary.clone();
        let umask = self.context.holder_umask;
        let scope = self.context.scope.clone();
        let events = self.events_tx.clone();
        tokio::spawn(async move {
            let event = match launch_holder(&binary, &socket, umask, scope.as_ref()).await {
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
}

/// Resolves when SIGTERM arrives, or never when the core could not listen for it.
async fn terminated(terminate: Option<&mut Signal>) {
    match terminate {
        Some(terminate) => {
            terminate.recv().await;
        }
        None => std::future::pending().await,
    }
}

fn control_frame(message: &impl serde::Serialize) -> Option<Vec<u8>> {
    let payload = serde_json::to_vec(message).ok()?;
    frame::encode(FrameKind::Control, 0, &payload).ok()
}
