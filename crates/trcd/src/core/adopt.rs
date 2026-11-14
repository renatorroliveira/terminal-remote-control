//! Adopting the holders a previous core started: every live socket in `run/holders` is reconnected and its
//! session recovered from the holder's `hello`; sockets nobody serves are removed (TECH_STACK §5.4). Every holder is
//! asked at once and given 2 s, so the core serves the app promptly however many holders it finds. One that is slow
//! to answer is asked again in the background, and one that still does not answer keeps its socket for the next
//! core: only a holder that says it never started a session is shut down (US-2.1, US-2.5).

use std::path::{Path, PathBuf};
use std::time::Duration;

use tokio::net::UnixStream;
use tokio::net::unix::OwnedReadHalf;
use tokio::task::{JoinHandle, JoinSet};
use tokio::time::timeout;
use trc_protocol::SessionId;
use trc_protocol::frame::{self, FrameKind};

use super::registry::SessionRecord;
use crate::frame_io::{FrameReader, FrameSender};
use crate::holder::protocol::{HolderCommand, HolderEvent, HolderSpec};
use crate::run_dir::RunDir;
use crate::session_id::is_session_id;

/// How long the holders have to introduce themselves when the core starts, all asked at once: well within the app's
/// 15 s handshake, so the core never keeps the app waiting on a holder.
const FIRST_INTRODUCTION: Duration = Duration::from_secs(2);
/// How long a holder that was silent at start has when asked again in the background.
const LATE_INTRODUCTION: Duration = Duration::from_secs(10);

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

/// The holders a starting core found.
#[derive(Default)]
pub struct Adoption {
    /// Those that introduced themselves in time, ordered by session start time.
    pub adopted: Vec<Adopted>,
    /// The sockets of live holders that did not answer in time, to ask again with [`adopt_late`].
    pub silent: Vec<(PathBuf, SessionId)>,
}

/// Asks every live holder at once to introduce itself, and removes stale sockets.
pub async fn adopt_holders(run: &RunDir) -> Adoption {
    let Ok(entries) = std::fs::read_dir(run.holders()) else {
        return Adoption::default();
    };
    let mut asked = JoinSet::new();
    for path in entries.filter_map(|entry| entry.ok().map(|entry| entry.path())) {
        if let Some(id) = session_id_of(&path) {
            asked.spawn(async move {
                let introduction = introduce_at(&path, &id, FIRST_INTRODUCTION).await;
                (path, id, introduction)
            });
        }
    }
    gather(asked).await
}

/// Asks a holder that was silent at start again; its session, or `None` when it is gone or still does not answer, in
/// which case its socket stays for the next core.
pub async fn adopt_late(path: &Path, id: &SessionId) -> Option<Adopted> {
    match introduce_at(path, id, LATE_INTRODUCTION).await {
        Introduction::Adopted(found) => Some(*found),
        Introduction::Silent => {
            tracing::warn!("a holder did not introduce itself; its socket is kept for the next core");
            None
        }
        Introduction::Gone => None,
    }
}

/// Collects every introduction, skipping one whose task failed so the others still finish.
async fn gather(mut asked: JoinSet<(PathBuf, SessionId, Introduction)>) -> Adoption {
    let mut adoption = Adoption::default();
    while let Some(joined) = asked.join_next().await {
        let Ok((path, id, introduction)) = joined else {
            tracing::warn!("a holder's introduction failed; the others go on");
            continue;
        };
        match introduction {
            Introduction::Adopted(found) => adoption.adopted.push(*found),
            Introduction::Silent => adoption.silent.push((path, id)),
            Introduction::Gone => {}
        }
    }
    adoption
        .adopted
        .sort_by_key(|found| (found.record.info.started_at.is_none(), found.record.info.started_at));
    adoption
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
    /// The holder runs a session, now adopted.
    Adopted(Box<Adopted>),
    /// Nothing serves the socket, which is removed, or the holder never started a session and was shut down.
    Gone,
    /// The holder did not answer in time.
    Silent,
}

async fn introduce_at(path: &Path, id: &SessionId, wait: Duration) -> Introduction {
    let Ok(stream) = UnixStream::connect(path).await else {
        let _ = std::fs::remove_file(path);
        return Introduction::Gone;
    };
    introduce(id.clone(), stream, wait).await
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
            return Introduction::Gone;
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

    #[tokio::test]
    async fn keeps_gathering_after_an_introduction_fails() {
        let mut asked = JoinSet::new();
        asked.spawn(async { panic!("a malformed hello") });
        asked.spawn(async {
            tokio::time::sleep(Duration::from_millis(50)).await;
            (
                PathBuf::from("0123456789abcdef.sock"),
                SessionId("0123456789abcdef".into()),
                Introduction::Silent,
            )
        });
        let adoption = gather(asked).await;
        assert_eq!(adoption.silent.len(), 1);
    }
}
