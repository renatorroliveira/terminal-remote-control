//! Adopting the holders a previous core started: every live socket in `run/holders` is reconnected and its
//! session recovered from the holder's `hello`; sockets nobody serves are removed (TECH_STACK §5.4).

use std::path::Path;
use std::time::Duration;

use tokio::net::UnixStream;
use tokio::net::unix::OwnedReadHalf;
use tokio::task::JoinHandle;
use tokio::time::timeout;
use trc_protocol::SessionId;
use trc_protocol::frame::{self, FrameKind};

use super::registry::SessionRecord;
use crate::frame_io::{FrameReader, FrameSender};
use crate::holder::protocol::{HolderCommand, HolderEvent};
use crate::run_dir::RunDir;
use crate::session_id::is_session_id;

/// How long a live holder has to introduce itself.
const INTRODUCTION_TIMEOUT: Duration = Duration::from_secs(2);

/// A session recovered from a running holder, with the open connection to it.
pub struct Adopted {
    /// The recovered session.
    pub record: SessionRecord,
    /// Frames from the holder, after its introduction.
    pub reader: FrameReader<OwnedReadHalf>,
    /// Frames to the holder.
    pub sender: FrameSender,
    /// The task writing to the holder.
    pub writer: JoinHandle<()>,
}

/// Reconnects to every live holder, ordered by session start time, and removes stale sockets.
pub async fn adopt_holders(run: &RunDir) -> Vec<Adopted> {
    let Ok(entries) = std::fs::read_dir(run.holders()) else {
        return Vec::new();
    };
    let mut adopted = Vec::new();
    for path in entries.filter_map(|entry| entry.ok().map(|entry| entry.path())) {
        let Some(id) = session_id_of(&path) else {
            continue;
        };
        match UnixStream::connect(&path).await {
            Ok(stream) => adopted.extend(introduce(id, stream).await),
            Err(_) => {
                let _ = std::fs::remove_file(&path);
            }
        }
    }
    adopted.sort_by_key(|found| (found.record.info.started_at.is_none(), found.record.info.started_at));
    adopted
}

fn session_id_of(path: &Path) -> Option<SessionId> {
    let name = path.file_name()?.to_str()?.strip_suffix(".sock")?;
    is_session_id(name).then(|| SessionId(name.to_owned()))
}

async fn introduce(id: SessionId, stream: UnixStream) -> Option<Adopted> {
    let (read, write) = stream.into_split();
    let mut reader = FrameReader::new(read);
    let (sender, writer) = FrameSender::spawn(write);
    let Some(HolderEvent::Hello { spec: Some(spec), name }) = next_event(&mut reader).await else {
        send_shutdown(&sender);
        return None;
    };
    let Some(HolderEvent::Status { status }) = next_event(&mut reader).await else {
        return None;
    };
    let mut record = SessionRecord::new(id, *spec, name);
    record.apply_status(&status);
    Some(Adopted {
        record,
        reader,
        sender,
        writer,
    })
}

async fn next_event(reader: &mut FrameReader<OwnedReadHalf>) -> Option<HolderEvent> {
    let frame = timeout(INTRODUCTION_TIMEOUT, reader.next()).await.ok()?.ok()??;
    (frame.kind == FrameKind::Control)
        .then(|| serde_json::from_slice(&frame.payload).ok())
        .flatten()
}

fn send_shutdown(sender: &FrameSender) {
    if let Ok(payload) = serde_json::to_vec(&HolderCommand::Shutdown)
        && let Ok(encoded) = frame::encode(FrameKind::Control, 0, &payload)
    {
        sender.send(encoded);
    }
}
