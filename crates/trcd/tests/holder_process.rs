//! `trcd holder --socket <path>` as the core starts it: a private socket that disappears on shutdown (SEC-02), and
//! a shell that keeps the umask the holder was started with.

use std::collections::BTreeMap;
use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use tokio::net::UnixStream;
use tokio::net::unix::OwnedReadHalf;
use trc_protocol::frame::{self, FrameKind};
use trc_protocol::{Integration, ProfileOrigin, ShellKind, ShellProfile, TerminalSize};
use trcd::frame_io::{FrameReader, FrameSender};
use trcd::holder::protocol::{HolderCommand, HolderEvent, HolderSpec};

const WAIT: Duration = Duration::from_secs(10);

#[tokio::test]
async fn serves_a_private_socket_and_removes_it_on_shutdown() {
    let socket = private_dir().join("holder.sock");
    let mut child = spawn_holder(&socket);
    wait_for(&socket);
    assert_eq!(std::fs::metadata(&socket).unwrap().permissions().mode() & 0o777, 0o600);

    let (sender, mut reader) = connect(&socket).await;
    command(&sender, &HolderCommand::Shutdown);
    assert!(saw_exiting(&mut reader).await);

    assert!(wait_child(&mut child).success());
    assert!(!socket.exists());
}

#[tokio::test]
async fn the_shell_inherits_the_holders_umask() {
    let socket = private_dir().join("umask.sock");
    let mut child = spawn_holder(&socket);
    wait_for(&socket);
    let (sender, mut reader) = connect(&socket).await;
    command(
        &sender,
        &HolderCommand::Start {
            spec: Box::new(umask_spec()),
        },
    );
    command(&sender, &HolderCommand::Attach { credit: 1 << 20 });
    assert!(output_until(&mut reader, "0027").await);
    command(&sender, &HolderCommand::Shutdown);
    assert!(saw_exiting(&mut reader).await);
    assert!(wait_child(&mut child).success());
}

#[test]
fn refuses_a_socket_path_that_is_taken() {
    let socket = private_dir().join("taken.sock");
    std::fs::write(&socket, b"").unwrap();
    let mut child = spawn_holder(&socket);
    assert_eq!(wait_child(&mut child).code(), Some(71));
    assert!(socket.exists());
}

fn spawn_holder(socket: &Path) -> Child {
    Command::new("/bin/sh")
        .args([
            "-c",
            "umask 027; exec \"$0\" holder --socket \"$1\"",
            env!("CARGO_BIN_EXE_trcd"),
        ])
        .arg(socket)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .unwrap()
}

async fn connect(socket: &Path) -> (FrameSender, FrameReader<OwnedReadHalf>) {
    let (read, write) = UnixStream::connect(socket).await.unwrap().into_split();
    let (sender, _writer) = FrameSender::spawn(write);
    (sender, FrameReader::new(read))
}

fn command(sender: &FrameSender, command: &HolderCommand) {
    let payload = serde_json::to_vec(command).unwrap();
    assert!(sender.send(frame::encode(FrameKind::Control, 0, &payload).unwrap()));
}

fn umask_spec() -> HolderSpec {
    HolderSpec {
        profile: ShellProfile {
            id: "umask".into(),
            name: "sh".into(),
            origin: ProfileOrigin::Detected,
            kind: ShellKind::Sh,
            path: "/bin/sh".into(),
            args: vec!["-c".into(), "umask".into()],
            login: false,
            env: BTreeMap::new(),
            cwd: None,
            integration: Integration::Off,
        },
        cwd: Some("/tmp".into()),
        env: BTreeMap::new(),
        size: TerminalSize { cols: 80, rows: 24 },
        scrollback_lines: 100,
        home: "/tmp".into(),
        user: "tester".into(),
    }
}

async fn output_until(reader: &mut FrameReader<OwnedReadHalf>, needle: &str) -> bool {
    let mut output = Vec::new();
    while !String::from_utf8_lossy(&output).contains(needle) {
        let Ok(Ok(Some(frame))) = tokio::time::timeout(WAIT, reader.next()).await else {
            return false;
        };
        if frame.kind == FrameKind::Output {
            output.extend(frame.payload);
        }
    }
    true
}

async fn saw_exiting(reader: &mut FrameReader<OwnedReadHalf>) -> bool {
    loop {
        let Ok(Ok(Some(frame))) = tokio::time::timeout(WAIT, reader.next()).await else {
            return false;
        };
        if matches!(serde_json::from_slice(&frame.payload), Ok(HolderEvent::Exiting)) {
            return true;
        }
    }
}

fn private_dir() -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("trcd-process-{}-{nanos}", std::process::id()));
    std::fs::DirBuilder::new().mode(0o700).create(&dir).unwrap();
    dir
}

fn wait_for(path: &Path) {
    let deadline = Instant::now() + WAIT;
    while !path.exists() {
        assert!(Instant::now() < deadline, "{} never appeared", path.display());
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn wait_child(child: &mut Child) -> std::process::ExitStatus {
    let deadline = Instant::now() + WAIT;
    loop {
        if let Some(status) = child.try_wait().unwrap() {
            return status;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            panic!("holder did not exit");
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}
