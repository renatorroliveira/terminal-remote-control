//! `trcd holder --socket <path>` as the core starts it: a private socket that disappears on shutdown and refuses
//! peers of another user (SEC-02), and a shell that keeps the umask the holder was started with.

mod support;

use std::collections::BTreeMap;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::time::Duration;

use support::{Installed, wait_child, wait_for};

use tokio::net::UnixStream;
use tokio::net::unix::OwnedReadHalf;
use trc_protocol::frame::{self, FrameKind};
use trc_protocol::{Integration, ProfileOrigin, ShellKind, ShellProfile, TerminalSize};
use trcd::frame_io::{FrameReader, FrameSender};
use trcd::holder::protocol::{HolderCommand, HolderEvent, HolderSpec};

const WAIT: Duration = support::WAIT;

#[tokio::test]
async fn serves_a_private_socket_and_removes_it_on_shutdown() {
    let installed = Installed::new();
    let socket = installed.base.join("holder.sock");
    let mut child = spawn_holder(&installed, &socket);
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
    let installed = Installed::new();
    let socket = installed.base.join("umask.sock");
    let mut child = spawn_holder(&installed, &socket);
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
    let installed = Installed::new();
    let socket = installed.base.join("taken.sock");
    std::fs::write(&socket, b"").unwrap();
    let mut child = spawn_holder(&installed, &socket);
    assert_eq!(wait_child(&mut child).code(), Some(71));
    assert!(socket.exists());
}

#[cfg(target_os = "linux")]
#[tokio::test]
async fn refuses_a_peer_of_another_user() {
    use std::os::unix::process::CommandExt;

    if !rustix::process::geteuid().is_root() {
        return;
    }
    let installed = Installed::new();
    let owner = 4243;
    chown_tree(&installed.base, owner);
    let socket = installed.base.join("foreign.sock");
    let mut holder = Command::new(&installed.binary);
    holder
        .args(["holder", "--socket"])
        .arg(&socket)
        .uid(owner)
        .gid(owner)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let mut child = holder.spawn().unwrap();
    wait_for(&socket);
    let (_sender, mut reader) = connect(&socket).await;
    let first = tokio::time::timeout(WAIT, reader.next()).await;
    assert!(
        matches!(first, Ok(Ok(None)) | Ok(Err(_))),
        "the holder answered a peer of another user"
    );
    child.kill().unwrap();
    let _ = wait_child(&mut child);
}

#[cfg(target_os = "linux")]
fn chown_tree(path: &Path, owner: u32) {
    let id = Some(rustix::process::Uid::from_raw(owner));
    let group = Some(rustix::process::Gid::from_raw(owner));
    rustix::fs::chown(path, id, group).unwrap();
    if path.is_dir() {
        for entry in std::fs::read_dir(path).unwrap() {
            chown_tree(&entry.unwrap().path(), owner);
        }
    }
}

fn spawn_holder(installed: &Installed, socket: &Path) -> Child {
    Command::new("/bin/sh")
        .args(["-c", "umask 027; exec \"$0\" holder --socket \"$1\""])
        .arg(&installed.binary)
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
