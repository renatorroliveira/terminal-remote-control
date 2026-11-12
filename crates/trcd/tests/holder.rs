//! The holder over its socket, driven the way the core drives it (US-1.7, US-1.9, US-1.10, US-1.11.3, D-19).

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::Duration;

use tokio::net::UnixStream;
use tokio::net::unix::OwnedReadHalf;
use tokio::time::timeout;
use trc_protocol::frame::{self, Frame, FrameKind};
use trc_protocol::{Integration, ProfileOrigin, SessionState, ShellKind, ShellProfile, TerminalSize};
use trcd::frame_io::{FrameReader, FrameSender};
use trcd::holder::protocol::{HolderCommand, HolderEvent, HolderSpec, HolderStatus, SESSION_STREAM};
use trcd::holder::service::Holder;

const WAIT: Duration = Duration::from_secs(10);

struct Client {
    socket: PathBuf,
    hellos: Vec<(Option<Box<HolderSpec>>, Option<String>)>,
    reader: FrameReader<OwnedReadHalf>,
    sender: FrameSender,
    output: Vec<u8>,
    statuses: Vec<HolderStatus>,
    exiting: bool,
}

impl Client {
    async fn connect(socket: &PathBuf) -> Self {
        let stream = UnixStream::connect(socket).await.unwrap();
        let (read, write) = stream.into_split();
        let (sender, _writer) = FrameSender::spawn(write);
        Self {
            socket: socket.clone(),
            hellos: Vec::new(),
            reader: FrameReader::new(read),
            sender,
            output: Vec::new(),
            statuses: Vec::new(),
            exiting: false,
        }
    }

    fn command(&self, command: &HolderCommand) {
        let payload = serde_json::to_vec(command).unwrap();
        assert!(
            self.sender
                .send(frame::encode(FrameKind::Control, 0, &payload).unwrap())
        );
    }

    fn input(&self, text: &str) {
        assert!(
            self.sender
                .send(frame::encode(FrameKind::Input, SESSION_STREAM, text.as_bytes()).unwrap())
        );
    }

    fn credit(&self, bytes: u32) {
        assert!(self.sender.send(frame::encode_credit(SESSION_STREAM, bytes)));
    }

    async fn step(&mut self) {
        let Ok(next) = timeout(WAIT, self.reader.next()).await else {
            let text = self.text();
            let tail = &text[text.len().saturating_sub(400)..];
            panic!(
                "holder went quiet; output ends with: {tail:?}; last status: {:?}",
                self.statuses.last()
            );
        };
        let frame: Frame = next.unwrap().expect("holder closed");
        self.absorb(frame);
    }

    fn absorb(&mut self, frame: Frame) {
        match frame.kind {
            FrameKind::Output => self.output.extend(frame.payload),
            FrameKind::Control => match serde_json::from_slice(&frame.payload).unwrap() {
                HolderEvent::Status { status } => self.statuses.push(status),
                HolderEvent::Exiting => self.exiting = true,
                HolderEvent::Hello { spec, name } => self.hellos.push((spec, name)),
            },
            other => panic!("unexpected frame {other:?}"),
        }
    }

    async fn until(&mut self, done: impl Fn(&Self) -> bool) {
        while !done(self) {
            self.step().await;
        }
    }

    fn text(&self) -> String {
        String::from_utf8_lossy(&self.output).into_owned()
    }

    fn last(&self) -> &HolderStatus {
        self.statuses.last().expect("a status")
    }
}

/// Waits until the shell has printed its prompt and gone quiet, so typed input never races line-editor queries.
async fn settle(client: &mut Client) {
    loop {
        match timeout(Duration::from_millis(500), client.reader.next()).await {
            Err(_) if !client.output.is_empty() => return,
            Err(_) => {}
            Ok(next) => {
                let frame = next.unwrap().expect("holder closed");
                client.absorb(frame);
            }
        }
    }
}

fn spec(program: &str) -> HolderSpec {
    HolderSpec {
        profile: ShellProfile {
            id: "test".into(),
            name: "sh".into(),
            origin: ProfileOrigin::Detected,
            kind: ShellKind::Sh,
            path: program.into(),
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

fn start_holder() -> PathBuf {
    let dir = std::env::temp_dir().join(format!("trcd-holder-test-{}-{}", std::process::id(), rand_suffix()));
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
    socket
}

fn rand_suffix() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos()
}

async fn started(program: &str) -> Client {
    started_with_credit(program, 1 << 20).await
}

async fn started_with_credit(program: &str, credit: u32) -> Client {
    let socket = start_holder();
    let mut client = loop {
        if socket.exists() {
            break Client::connect(&socket).await;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    };
    client.command(&HolderCommand::Start {
        spec: Box::new(spec(program)),
    });
    client.command(&HolderCommand::Attach { credit });
    client
        .until(|c| c.statuses.last().is_some_and(|s| s.state == SessionState::Running))
        .await;
    settle(&mut client).await;
    client
}

#[tokio::test]
async fn runs_the_shell_and_relays_input_and_output() {
    let mut client = started("/bin/sh").await;
    assert!(client.last().pid.is_some() && client.last().started_at.is_some());
    client.input("echo trc-$((6*7))\r");
    client.until(|c| c.text().contains("trc-42")).await;
}

#[tokio::test]
async fn reports_the_exit_code() {
    let mut client = started("/bin/sh").await;
    client.input("exit 7\r");
    client.until(|c| c.last().state == SessionState::Exited).await;
    assert_eq!(client.last().exit.as_ref().and_then(|exit| exit.code), Some(7));
    assert_eq!(client.last().pid, None);
}

#[tokio::test]
async fn escalates_from_hangup_to_kill_when_stopping() {
    let mut client = started("/bin/sh").await;
    client.input("trap '' HUP TERM; echo armed\r");
    client.until(|c| c.text().contains("armed\r\n")).await;
    client.command(&HolderCommand::Stop { grace_ms: Some(200) });
    client.until(|c| c.last().state == SessionState::Stopped).await;
    assert!(
        client.last().exit.as_ref().is_some_and(|exit| exit.signal.is_some()),
        "{:?}",
        client.last()
    );
}

#[tokio::test]
async fn restarts_with_a_marker_and_keeps_the_scrollback() {
    let mut client = started("/bin/sh").await;
    client.input("echo before-restart\r");
    client.until(|c| c.text().contains("before-restart\r\n")).await;
    let first_pid = client.last().pid;
    client.command(&HolderCommand::Restart);
    client.until(|c| c.text().contains("[Restarted at ")).await;
    client
        .until(|c| c.last().state == SessionState::Running && c.last().pid != first_pid)
        .await;
    client.command(&HolderCommand::Detach);
    client.command(&HolderCommand::Attach { credit: 1 << 20 });
    client.output.clear();
    client
        .until(|c| c.text().contains("before-restart") && c.text().contains("[Restarted at "))
        .await;
}

#[tokio::test]
async fn restarts_in_the_last_known_working_directory() {
    let mut client = started("/bin/sh").await;
    client.input("cd /usr && printf '\\033]7;file://localhost/usr\\033\\\\'\r");
    client.until(|c| c.last().cwd.as_deref() == Some("/usr")).await;
    let first_pid = client.last().pid;
    client.command(&HolderCommand::Restart);
    client
        .until(|c| c.last().state == SessionState::Running && c.last().pid != first_pid)
        .await;
    settle(&mut client).await;
    client.output.clear();
    client.input("pwd\r");
    client.until(|c| c.text().contains("/usr\r\n")).await;
}

#[tokio::test]
async fn introduces_its_session_and_name_to_every_new_core() {
    let mut client = started("/bin/sh").await;
    assert_eq!(client.hellos, vec![(None, None)]);
    client.command(&HolderCommand::Name {
        name: Some("build".into()),
    });
    client.command(&HolderCommand::Resize {
        size: TerminalSize { cols: 90, rows: 20 },
    });
    client.until(|c| c.last().size.cols == 90).await;
    let mut next = Client::connect(&client.socket).await;
    next.until(|c| !c.hellos.is_empty() && !c.statuses.is_empty()).await;
    let (spec, name) = next.hellos.remove(0);
    assert_eq!(spec.map(|spec| spec.profile.path), Some("/bin/sh".to_owned()));
    assert_eq!(name.as_deref(), Some("build"));
    assert_eq!(next.last().state, SessionState::Running);
}

#[tokio::test]
async fn resizes_the_pty_and_the_emulator() {
    let mut client = started("/bin/sh").await;
    client.command(&HolderCommand::Resize {
        size: TerminalSize { cols: 120, rows: 40 },
    });
    client
        .until(|c| c.last().size == TerminalSize { cols: 120, rows: 40 })
        .await;
    client.input("stty size\r");
    client.until(|c| c.text().contains("40 120")).await;
}

#[tokio::test]
async fn answers_terminal_queries_from_the_emulator() {
    if !std::path::Path::new("/bin/bash").exists() {
        return;
    }
    let mut client = started("/bin/bash").await;
    client.input("printf '\\033[6n'; read -rs -d R reply; echo \"cpr=${reply#*[}\"\r");
    client.until(|c| c.text().contains("cpr=")).await;
    client.until(|c| c.text().contains(";")).await;
}

#[tokio::test]
async fn never_sends_more_output_than_the_credit() {
    let mut client = started_with_credit("/bin/sh", 4_096).await;
    client.input("yes trc | head -c 200000; echo; echo done-flooding\r");
    let mut granted: usize = 4_096;
    while !client.text().contains("done-flooding") {
        assert!(
            client.output.len() <= granted,
            "received {} with {granted} granted",
            client.output.len()
        );
        if client.output.len() == granted {
            client.credit(16_384);
            granted += 16_384;
        }
        client.step().await;
    }
}

#[tokio::test]
async fn shuts_down_after_stopping_the_process() {
    let mut client = started("/bin/sh").await;
    client.command(&HolderCommand::Shutdown);
    client.until(|c| c.exiting).await;
    assert!(matches!(
        client.last().state,
        SessionState::Stopped | SessionState::Exited
    ));
}
