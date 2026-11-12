//! The shared protocol fixtures (`protocol/fixtures/v1`) match what this crate encodes and decodes (NFR-12).
//!
//! Run with `TRC_BLESS_FIXTURES=1` to rewrite the fixtures after an intended change.

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::Serialize;
use serde::de::DeserializeOwned;
use trc_protocol::frame::{self, FrameDecoder, FrameKind};
use trc_protocol::{
    AttachMode, ClientMessage, CreateSessionSpec, ErrorCode, ExitStatus, Integration, ProfileOrigin, ServerMessage,
    SessionChange, SessionId, SessionInfo, SessionState, ShellKind, ShellProfile, TerminalSize,
};

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../protocol/fixtures/v1")
}

fn blessing() -> bool {
    std::env::var_os("TRC_BLESS_FIXTURES").is_some()
}

fn login_profile() -> ShellProfile {
    ShellProfile {
        id: "login".into(),
        name: "bash".into(),
        origin: ProfileOrigin::Login,
        kind: ShellKind::Bash,
        path: "/bin/bash".into(),
        args: vec![],
        login: true,
        env: BTreeMap::new(),
        cwd: None,
        integration: Integration::Auto,
    }
}

fn session(id: &str, state: SessionState) -> SessionInfo {
    SessionInfo {
        id: SessionId(id.into()),
        custom_name: Some("build".into()),
        title: Some("make -j8".into()),
        order: 0,
        state,
        profile: login_profile(),
        cwd: Some("/home/tester/src".into()),
        size: TerminalSize { cols: 120, rows: 30 },
        pid: Some(4242),
        started_at: Some(1_794_400_000_000),
        last_output_at: Some(1_794_400_005_000),
        exit: None,
        failure: None,
    }
}

fn client_messages() -> Vec<(&'static str, ClientMessage)> {
    let id = || SessionId("s-1".into());
    vec![
        (
            "hello",
            ClientMessage::Hello {
                min_proto: 1,
                max_proto: 1,
                app_version: "0.1.0".into(),
                caps: vec![],
            },
        ),
        ("ping", ClientMessage::Ping { request_id: 1 }),
        ("list-sessions", ClientMessage::ListSessions { request_id: 2 }),
        ("list-profiles", ClientMessage::ListProfiles { request_id: 3 }),
        (
            "create",
            ClientMessage::Create {
                request_id: 4,
                spec: CreateSessionSpec {
                    profile_id: Some("login".into()),
                    cwd: Some("/home/tester".into()),
                    name: None,
                    env: BTreeMap::from([("EDITOR".into(), Some("vim".into())), ("PAGER".into(), None)]),
                    size: TerminalSize { cols: 80, rows: 24 },
                    scrollback_lines: Some(10_000),
                },
            },
        ),
        (
            "rename",
            ClientMessage::Rename {
                request_id: 5,
                session: id(),
                name: Some("build".into()),
            },
        ),
        (
            "rename-clear",
            ClientMessage::Rename {
                request_id: 6,
                session: id(),
                name: None,
            },
        ),
        (
            "reorder",
            ClientMessage::Reorder {
                request_id: 7,
                session: id(),
                index: 2,
            },
        ),
        (
            "stop",
            ClientMessage::Stop {
                request_id: 8,
                session: id(),
                grace_ms: Some(3000),
            },
        ),
        (
            "restart",
            ClientMessage::Restart {
                request_id: 9,
                session: id(),
            },
        ),
        (
            "close",
            ClientMessage::Close {
                request_id: 10,
                session: id(),
            },
        ),
        (
            "attach",
            ClientMessage::Attach {
                request_id: 11,
                session: id(),
                mode: AttachMode::Full,
            },
        ),
        (
            "detach",
            ClientMessage::Detach {
                request_id: 12,
                session: id(),
            },
        ),
        (
            "resize",
            ClientMessage::Resize {
                request_id: 13,
                session: id(),
                size: TerminalSize { cols: 100, rows: 40 },
            },
        ),
    ]
}

fn server_messages() -> Vec<(&'static str, ServerMessage)> {
    let mut exited = session("s-2", SessionState::Exited);
    exited.pid = None;
    exited.exit = Some(ExitStatus {
        code: Some(1),
        signal: None,
    });
    vec![
        (
            "welcome",
            ServerMessage::Welcome {
                proto: 1,
                daemon_version: "0.1.0".into(),
                binary_sha256: "ab".repeat(32),
                caps: vec![],
            },
        ),
        (
            "incompatible",
            ServerMessage::Incompatible {
                min_proto: 2,
                max_proto: 3,
            },
        ),
        ("pong", ServerMessage::Pong { request_id: 1 }),
        (
            "sessions",
            ServerMessage::Sessions {
                request_id: 2,
                sessions: vec![session("s-1", SessionState::Running), exited],
            },
        ),
        (
            "profiles",
            ServerMessage::Profiles {
                request_id: 3,
                profiles: vec![login_profile()],
            },
        ),
        (
            "created",
            ServerMessage::Created {
                request_id: 4,
                session: session("s-1", SessionState::Starting),
            },
        ),
        (
            "attached",
            ServerMessage::Attached {
                request_id: 11,
                session: SessionId("s-1".into()),
                stream: 1,
                credit: 262_144,
            },
        ),
        ("done", ServerMessage::Done { request_id: 5 }),
        (
            "session-updated",
            ServerMessage::SessionEvent {
                change: SessionChange::Updated {
                    session: session("s-1", SessionState::Running),
                },
            },
        ),
        (
            "session-closed",
            ServerMessage::SessionEvent {
                change: SessionChange::Closed {
                    session_id: SessionId("s-2".into()),
                },
            },
        ),
        (
            "sessions-reordered",
            ServerMessage::SessionEvent {
                change: SessionChange::Reordered {
                    order: vec![SessionId("s-2".into()), SessionId("s-1".into())],
                },
            },
        ),
        (
            "error",
            ServerMessage::Error {
                request_id: Some(9),
                code: ErrorCode::UnknownSession,
                message: "no session s-9".into(),
            },
        ),
    ]
}

fn check_message<T: Serialize + DeserializeOwned + PartialEq + std::fmt::Debug>(dir: &str, name: &str, value: &T) {
    let path = fixtures_dir().join(dir).join(format!("{name}.json"));
    let encoded = serde_json::to_string_pretty(value).unwrap() + "\n";
    if blessing() {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, &encoded).unwrap();
    }
    let fixture = std::fs::read_to_string(&path).unwrap_or_else(|_| panic!("missing fixture {}", path.display()));
    assert_eq!(fixture, encoded, "{} differs from the encoder", path.display());
    assert_eq!(
        &serde_json::from_str::<T>(&fixture).unwrap(),
        value,
        "{} decodes differently",
        path.display()
    );
}

#[test]
fn client_message_fixtures_match() {
    for (name, message) in client_messages() {
        check_message("client", name, &message);
    }
}

#[test]
fn server_message_fixtures_match() {
    for (name, message) in server_messages() {
        check_message("server", name, &message);
    }
}

#[test]
fn frame_fixture_decodes_to_its_description() {
    let control = serde_json::to_vec(&ClientMessage::Ping { request_id: 1 }).unwrap();
    let frames = [
        (FrameKind::Control, 0, control),
        (FrameKind::Output, 1, b"hello\r\n".to_vec()),
        (FrameKind::Input, 1, b"\x03".to_vec()),
        (FrameKind::Credit, 1, 65_536u32.to_be_bytes().to_vec()),
    ];
    let wire: Vec<u8> = frames
        .iter()
        .flat_map(|(kind, stream, payload)| frame::encode(*kind, *stream, payload).unwrap())
        .collect();
    let path = fixtures_dir().join("frames.bin");
    if blessing() {
        std::fs::write(&path, &wire).unwrap();
    }
    assert_eq!(std::fs::read(&path).unwrap(), wire);

    let mut decoder = FrameDecoder::new();
    decoder.push(&wire);
    for (kind, stream, payload) in frames {
        let decoded = decoder.next_frame().unwrap().unwrap();
        assert_eq!((decoded.kind, decoded.stream, decoded.payload), (kind, stream, payload));
    }
    assert_eq!(decoder.next_frame().unwrap(), None);
}
