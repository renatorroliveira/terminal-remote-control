//! Adopting the holders a previous core started: every live socket in `run/holders` is reconnected and its
//! session recovered from the holder's `hello`; sockets nobody serves are removed (TECH_STACK §5.4). A holder that
//! is slow to answer is asked again, and one that still does not answer keeps its socket for the next core: only a
//! holder that says it never started a session is shut down (US-2.1, US-2.5).

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
use crate::holder::protocol::{HolderCommand, HolderEvent, HolderSpec};
use crate::run_dir::RunDir;
use crate::session_id::is_session_id;

/// How long a live holder has to introduce itself, the first time and when asked again.
const INTRODUCTION_TIMEOUTS: [Duration; 2] = [Duration::from_secs(2), Duration::from_secs(10)];

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
        adopted.extend(adopt(&path, &id).await);
    }
    adopted.sort_by_key(|found| (found.record.info.started_at.is_none(), found.record.info.started_at));
    adopted
}

fn session_id_of(path: &Path) -> Option<SessionId> {
    let name = path.file_name()?.to_str()?.strip_suffix(".sock")?;
    is_session_id(name).then(|| SessionId(name.to_owned()))
}

/// What a holder's first event says about it.
enum Greeting {
    /// It runs a session.
    Started(Box<HolderSpec>, Option<String>),
    /// It was never given a session to run.
    Unstarted,
    /// It did not introduce itself in time, or said something else.
    Silent,
}

/// How an introduction went.
enum Introduction {
    Adopted(Box<Adopted>),
    Unstarted,
    Silent,
}

async fn adopt(path: &Path, id: &SessionId) -> Option<Adopted> {
    for wait in INTRODUCTION_TIMEOUTS {
        let Ok(stream) = UnixStream::connect(path).await else {
            let _ = std::fs::remove_file(path);
            return None;
        };
        match introduce(id.clone(), stream, wait).await {
            Introduction::Adopted(found) => return Some(*found),
            Introduction::Unstarted => return None,
            Introduction::Silent => {}
        }
    }
    tracing::warn!("a holder did not introduce itself; its socket is kept for the next core");
    None
}

fn greeting(event: Option<HolderEvent>) -> Greeting {
    match event {
        Some(HolderEvent::Hello { spec: Some(spec), name }) => Greeting::Started(spec, name),
        Some(HolderEvent::Hello { spec: None, .. }) => Greeting::Unstarted,
        _ => Greeting::Silent,
    }
}

async fn introduce(id: SessionId, stream: UnixStream, wait: Duration) -> Introduction {
    let (read, write) = stream.into_split();
    let mut reader = FrameReader::new(read);
    let (sender, writer) = FrameSender::spawn(write);
    let (spec, name) = match greeting(next_event(&mut reader, wait).await) {
        Greeting::Started(spec, name) => (spec, name),
        Greeting::Unstarted => {
            send_shutdown(&sender);
            return Introduction::Unstarted;
        }
        Greeting::Silent => return Introduction::Silent,
    };
    let Some(HolderEvent::Status { status }) = next_event(&mut reader, wait).await else {
        return Introduction::Silent;
    };
    let mut record = SessionRecord::new(id, *spec, name);
    record.apply_status(&status);
    Introduction::Adopted(Box::new(Adopted {
        record,
        reader,
        sender,
        writer,
    }))
}

async fn next_event(reader: &mut FrameReader<OwnedReadHalf>, wait: Duration) -> Option<HolderEvent> {
    let frame = timeout(wait, reader.next()).await.ok()?.ok()??;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tells_a_holder_never_started_from_one_that_did_not_answer_in_time() {
        let unstarted = Some(HolderEvent::Hello { spec: None, name: None });
        assert!(matches!(greeting(unstarted), Greeting::Unstarted));
        assert!(matches!(greeting(None), Greeting::Silent));
        assert!(matches!(greeting(Some(HolderEvent::Exiting)), Greeting::Silent));
    }
}
