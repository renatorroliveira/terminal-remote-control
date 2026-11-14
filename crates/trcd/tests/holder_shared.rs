//! The holder driven the way a protocol 2 core drives it: several attachments on their own streams, replays from an
//! offset, and output that never waits for a slow client (US-2.1.2, US-2.2.2, US-2.6, D-04).

use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::time::Duration;

use tokio::net::UnixStream;
use tokio::net::unix::OwnedReadHalf;
use tokio::time::timeout;
use trc_protocol::frame::{self, FrameKind};
use trc_protocol::{
    Integration, ProfileOrigin, Replay, ResyncKind, SessionState, ShellKind, ShellProfile, TerminalSize,
};
use trcd::frame_io::{FrameReader, FrameSender};
use trcd::holder::protocol::{HOLDER_PROTOCOL, HolderCommand, HolderEvent, HolderSpec};
use trcd::holder::service::Holder;

const WAIT: Duration = Duration::from_secs(10);

/// How much of each attachment's latest output the test keeps to search.
const TAIL: usize = 4 * 1024;

struct Core {
    reader: FrameReader<OwnedReadHalf>,
    sender: FrameSender,
    received: HashMap<u32, Stream>,
    events: Vec<HolderEvent>,
    running: bool,
}

/// One attachment's output: how many bytes arrived, the latest of them, and where the last `synced` left the count.
#[derive(Default)]
struct Stream {
    bytes: u64,
    tail: Vec<u8>,
    synced: Option<(u64, u64)>,
}

impl Stream {
    fn push(&mut self, payload: &[u8]) {
        self.bytes += payload.len() as u64;
        self.tail.extend_from_slice(payload);
        let excess = self.tail.len().saturating_sub(TAIL);
        self.tail.drain(..excess);
    }

    /// The offset of the next byte, counting from the last `synced`.
    fn offset(&self) -> Option<u64> {
        self.synced.map(|(offset, at)| offset + self.bytes - at)
    }
}

impl Core {
    async fn connect(socket: &PathBuf) -> Self {
        let stream = UnixStream::connect(socket).await.unwrap();
        let (read, write) = stream.into_split();
        let (sender, _writer) = FrameSender::spawn(write);
        Self {
            reader: FrameReader::new(read),
            sender,
            received: HashMap::new(),
            events: Vec::new(),
            running: false,
        }
    }

    fn command(&self, command: &HolderCommand) {
        let payload = serde_json::to_vec(command).unwrap();
        assert!(
            self.sender
                .send(frame::encode(FrameKind::Control, 0, &payload).unwrap())
        );
    }

    fn attach(&self, attachment: u32, credit: u32, from_offset: Option<u64>) {
        self.command(&HolderCommand::Attach {
            credit,
            attachment: Some(attachment),
            from_offset,
            legacy: false,
        });
    }

    fn input(&self, attachment: u32, text: &str) {
        assert!(
            self.sender
                .send(frame::encode(FrameKind::Input, attachment, text.as_bytes()).unwrap())
        );
    }

    fn credit(&self, attachment: u32, bytes: u32) {
        assert!(self.sender.send(frame::encode_credit(attachment, bytes)));
    }

    fn text(&self, attachment: u32) -> String {
        String::from_utf8_lossy(self.received.get(&attachment).map_or(&[][..], |s| s.tail.as_slice())).into_owned()
    }

    fn bytes(&self, attachment: u32) -> u64 {
        self.received.get(&attachment).map_or(0, |s| s.bytes)
    }

    async fn until(&mut self, done: impl Fn(&Self) -> bool) {
        while !done(self) {
            let Ok(next) = timeout(WAIT, self.reader.next()).await else {
                panic!("holder went quiet; events: {:?}", self.events);
            };
            let frame = next.unwrap().expect("holder closed");
            match frame.kind {
                FrameKind::Output => self.received.entry(frame.stream).or_default().push(&frame.payload),
                FrameKind::Control => {
                    let event: HolderEvent = serde_json::from_slice(&frame.payload).unwrap();
                    match &event {
                        HolderEvent::Status { status } => self.running = status.state == SessionState::Running,
                        HolderEvent::Synced { attachment, offset } => {
                            let stream = self.received.entry(*attachment).or_default();
                            stream.synced = Some((*offset, stream.bytes));
                        }
                        _ => {}
                    }
                    self.events.push(event);
                }
                other => panic!("unexpected frame {other:?}"),
            }
        }
    }

    fn synced(&self, attachment: u32) -> Option<u64> {
        self.events.iter().rev().find_map(|event| match event {
            HolderEvent::Synced { attachment: a, offset } if *a == attachment => Some(*offset),
            _ => None,
        })
    }
}

fn spec() -> HolderSpec {
    HolderSpec {
        profile: ShellProfile {
            id: "test".into(),
            name: "sh".into(),
            origin: ProfileOrigin::Detected,
            kind: ShellKind::Sh,
            path: "/bin/sh".into(),
            args: vec![],
            login: false,
            env: BTreeMap::from([("PS1".into(), Some("$ ".into()))]),
            cwd: None,
            integration: Integration::Off,
        },
        cwd: Some("/tmp".into()),
        env: BTreeMap::new(),
        size: TerminalSize { cols: 100, rows: 30 },
        scrollback_lines: 1_000,
        home: "/tmp".into(),
        user: "tester".into(),
    }
}

async fn started() -> Core {
    let dir = std::env::temp_dir().join(format!(
        "trcd-shared-test-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let socket = dir.join("holder.sock");
    let listener_path = socket.clone();
    std::thread::spawn(move || {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async move {
            let listener = tokio::net::UnixListener::bind(&listener_path).unwrap();
            Holder::new().run(listener).await;
        });
    });
    let mut core = loop {
        if socket.exists() {
            break Core::connect(&socket).await;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    };
    core.command(&HolderCommand::Start { spec: Box::new(spec()) });
    core.until(|c| c.running).await;
    core
}

#[tokio::test]
async fn introduces_itself_with_its_holder_protocol() {
    let core = started().await;
    assert!(core.events.iter().any(|event| matches!(
        event,
        HolderEvent::Hello { proto: Some(proto), .. } if *proto == HOLDER_PROTOCOL
    )));
}

#[tokio::test]
async fn shares_output_and_tells_each_client_when_another_types() {
    let mut core = started().await;
    core.attach(7, u32::MAX, None);
    core.attach(8, u32::MAX, None);
    core.until(|c| c.synced(7).is_some() && c.synced(8).is_some()).await;
    core.input(7, "echo shared-$((2+3))\r");
    core.until(|c| c.text(7).contains("shared-5") && c.text(8).contains("shared-5"))
        .await;
    core.until(|c| c.events.contains(&HolderEvent::PeerInput { attachment: 8 }))
        .await;
    assert!(!core.events.contains(&HolderEvent::PeerInput { attachment: 7 }));
}

#[tokio::test]
async fn replays_only_what_a_client_missed() {
    let mut core = started().await;
    core.attach(1, u32::MAX, None);
    core.attach(2, u32::MAX, None);
    core.until(|c| c.synced(1).is_some() && c.synced(2).is_some()).await;
    core.input(1, "echo seen-$((1+1))\r");
    core.until(|c| c.text(1).contains("seen-2\r\n$ ")).await;
    let offset = core.received[&1].offset().unwrap();
    core.command(&HolderCommand::Detach { attachment: Some(1) });
    core.input(2, "echo missed-$((3+4))\r");
    core.until(|c| c.text(2).contains("missed-7")).await;
    core.received.remove(&1);
    core.attach(1, u32::MAX, Some(offset));
    core.until(|c| c.text(1).contains("missed-7")).await;
    assert!(core.events.contains(&HolderEvent::Attached {
        attachment: 1,
        replay: Replay::Delta
    }));
    assert!(!core.text(1).contains("seen-2"), "{:?}", core.text(1));
}

#[tokio::test]
async fn never_blocks_the_program_on_a_client_without_credit() {
    let mut core = started().await;
    core.attach(1, 1 << 20, None);
    core.attach(2, u32::MAX, None);
    core.until(|c| c.synced(1).is_some() && c.synced(2).is_some()).await;
    core.input(2, "yes trc | head -c 8000000 >/dev/tty; echo flood-$((5+5))\r");
    core.until(|c| c.text(2).contains("flood-10")).await;
    core.credit(1, 1 << 20);
    core.until(|c| {
        c.events.contains(&HolderEvent::Resync {
            attachment: 1,
            kind: ResyncKind::Screen,
        })
    })
    .await;
    core.until(|c| {
        c.events
            .iter()
            .filter(|e| matches!(e, HolderEvent::Synced { attachment: 1, .. }))
            .count()
            == 2
    })
    .await;
    assert!(core.bytes(1) <= 3 << 20, "the slow client got {} bytes", core.bytes(1));
}
