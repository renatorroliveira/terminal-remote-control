//! `trcd core` serving several apps on one session, protocol 1 and 2 clients side by side, reconnects from an offset,
//! and sessions whose holder an E1 core started (US-2.2.2, US-2.5.3, US-2.6, NFR-12).

mod support;

use std::collections::BTreeMap;
use std::os::unix::fs::DirBuilderExt;
use std::time::Duration;

use support::{AppClient, Installed, stop};
use tokio::net::UnixListener;
use trc_protocol::frame::{self, FrameKind};
use trc_protocol::{
    AttachMode, ClientMessage, CreateSessionSpec, DetachReason, ErrorCode, Integration, ProfileOrigin, Replay,
    ResyncKind, ServerMessage, SessionId, SessionInfo, SessionState, ShellKind, ShellProfile, TerminalSize,
};
use trcd::frame_io::{FrameReader, FrameSender};
use trcd::holder::protocol::{HolderCommand, HolderEvent, HolderSpec, HolderStatus, SESSION_STREAM};

const SIZE: TerminalSize = TerminalSize { cols: 100, rows: 30 };

async fn create(client: &mut AppClient) -> SessionInfo {
    client.send(&ClientMessage::Create {
        request_id: 1,
        spec: CreateSessionSpec {
            profile_id: None,
            cwd: None,
            name: None,
            env: BTreeMap::from([("PS1".into(), Some("$ ".into()))]),
            size: SIZE,
            scrollback_lines: None,
            options: None,
        },
    });
    let ServerMessage::Created { session, .. } = client
        .take(|m| matches!(m, ServerMessage::Created { request_id: 1, .. }))
        .await
    else {
        unreachable!()
    };
    session
}

/// Attaches and returns the stream and the attach reply's replay.
async fn attach(
    client: &mut AppClient,
    request_id: u32,
    id: &SessionId,
    from_offset: Option<u64>,
) -> (u32, Option<Replay>) {
    client.send(&ClientMessage::Attach {
        request_id,
        session: id.clone(),
        mode: AttachMode::Full,
        from_offset,
    });
    let ServerMessage::Attached { stream, replay, .. } = client
        .take(|m| matches!(m, ServerMessage::Attached { request_id: r, .. } if *r == request_id))
        .await
    else {
        unreachable!()
    };
    (stream, replay)
}

async fn synced(client: &mut AppClient, stream: u32) -> u64 {
    let ServerMessage::Synced { offset, .. } = client
        .take(|m| matches!(m, ServerMessage::Synced { stream: s, .. } if *s == stream))
        .await
    else {
        unreachable!()
    };
    offset
}

/// Whether output ends at a shell prompt: `$ ` for a user, `# ` for root, as in the Linux containers, perhaps followed
/// by the cursor position query busybox ash sends, or, in a snapshot taken once the prompt was up, by the empty rows
/// below it and the move back to its cursor.
fn at_prompt(text: &str) -> bool {
    let text = without_trailing_controls(text);
    text.ends_with("$ ") || text.ends_with("# ")
}

/// `text` without the control sequences (`ESC [` parameters and a final byte) and empty rows at its end.
fn without_trailing_controls(mut text: &str) -> &str {
    loop {
        let trimmed = text.trim_end_matches("\r\n");
        let Some(start) = trimmed.rfind("\x1b[") else {
            return trimmed;
        };
        let Some((last, parameters)) = trimmed.as_bytes()[start + 2..].split_last() else {
            return trimmed;
        };
        if !(0x40..=0x7e).contains(last) || !parameters.iter().all(|byte| (0x30..=0x3f).contains(byte)) {
            return trimmed;
        }
        text = &trimmed[..start];
    }
}

#[test]
fn sees_a_prompt_at_the_end_of_live_output_and_of_a_snapshot() {
    assert!(at_prompt("echo x\r\nx\r\n$ "));
    assert!(at_prompt("host:~# \x1b[6n"));
    assert!(at_prompt("\x1b[H\x1b[3ghost:~# \r\n\r\n\r\n\x1b[1;17H\x1b[0m"));
    assert!(!at_prompt("echo both-$((1+2))"));
    assert!(!at_prompt("\x1b[Hloading\r\n\x1b[2;1H"));
}

async fn prompt(client: &mut AppClient, stream: u32) {
    client.until(|c| at_prompt(&c.text(stream))).await;
    client.settle().await;
}

#[tokio::test]
async fn shares_a_session_between_two_apps() {
    let installed = Installed::new();
    let core = installed.start_core();
    let mut first = AppClient::greeted_with(&installed.core_socket(), 2).await;
    let mut second = AppClient::greeted_with(&installed.core_socket(), 2).await;
    let session = create(&mut first).await;
    let (a, replay) = attach(&mut first, 2, &session.id, None).await;
    assert_eq!(replay, Some(Replay::Snapshot));
    synced(&mut first, a).await;
    prompt(&mut first, a).await;
    let (b, _) = attach(&mut second, 2, &session.id, None).await;
    synced(&mut second, b).await;
    first.input(a, "echo both-$((1+2))\r");
    first.until(|c| c.text(a).contains("both-3")).await;
    second.until(|c| c.text(b).contains("both-3")).await;
    second
        .take(|m| matches!(m, ServerMessage::PeerInput { session: s, stream } if s == &session.id && *stream == b))
        .await;
    stop(core);
}

#[tokio::test]
async fn serves_a_protocol_1_app_beside_a_protocol_2_app() {
    let installed = Installed::new();
    let core = installed.start_core();
    let mut old = AppClient::greeted(&installed.core_socket()).await;
    let mut new = AppClient::greeted_with(&installed.core_socket(), 2).await;
    let session = create(&mut new).await;
    let (n, _) = attach(&mut new, 2, &session.id, None).await;
    synced(&mut new, n).await;
    prompt(&mut new, n).await;
    let (o, replay) = attach(&mut old, 2, &session.id, None).await;
    assert_eq!(replay, None);
    old.until(|c| c.text(o).contains("$ ") || c.text(o).contains("# "))
        .await;
    new.input(n, "echo mixed-$((2+2))\r");
    old.until(|c| c.text(o).contains("mixed-4")).await;
    assert!(
        old.messages
            .iter()
            .all(|m| !matches!(m, ServerMessage::Synced { .. } | ServerMessage::PeerInput { .. })),
        "{:?}",
        old.messages
    );
    stop(core);
}

#[tokio::test]
async fn replays_only_the_output_an_app_missed_while_away() {
    let installed = Installed::new();
    let core = installed.start_core();
    let mut away = AppClient::greeted_with(&installed.core_socket(), 2).await;
    let session = create(&mut away).await;
    let (a, _) = attach(&mut away, 2, &session.id, None).await;
    let start = synced(&mut away, a).await;
    let before = away.output.get(&a).map_or(0, Vec::len) as u64;
    prompt(&mut away, a).await;
    away.input(a, "echo seen-$((4+4))\r");
    away.until(|c| c.text(a).contains("seen-8\r\n") && at_prompt(&c.text(a)))
        .await;
    let offset = start + away.output[&a].len() as u64 - before;
    drop(away);
    let mut other = AppClient::greeted_with(&installed.core_socket(), 2).await;
    let (o, _) = attach(&mut other, 2, &session.id, None).await;
    synced(&mut other, o).await;
    other.settle().await;
    other.input(o, "echo missed-$((5+5))\r");
    other
        .until(|c| c.text(o).contains("missed-10\r\n") && at_prompt(&c.text(o)))
        .await;
    let mut back = AppClient::greeted_with(&installed.core_socket(), 2).await;
    let (b, replay) = attach(&mut back, 2, &session.id, Some(offset)).await;
    assert_eq!(replay, Some(Replay::Delta));
    synced(&mut back, b).await;
    assert!(back.text(b).contains("missed-10"), "{:?}", back.text(b));
    assert!(!back.text(b).contains("seen-8"), "{:?}", back.text(b));
    stop(core);
}

#[tokio::test]
async fn refresh_sends_the_whole_scrollback_again() {
    let installed = Installed::new();
    let core = installed.start_core();
    let mut client = AppClient::greeted_with(&installed.core_socket(), 2).await;
    let session = create(&mut client).await;
    let (stream, _) = attach(&mut client, 2, &session.id, None).await;
    synced(&mut client, stream).await;
    client.send(&ClientMessage::Refresh {
        request_id: 3,
        session: session.id.clone(),
    });
    client
        .take(|m| matches!(m, ServerMessage::Done { request_id: 3 }))
        .await;
    client
        .take(|m| matches!(m, ServerMessage::Resync { kind: ResyncKind::Full, stream: s, .. } if *s == stream))
        .await;
    synced(&mut client, stream).await;
    stop(core);
}

fn fake_spec(home: &str) -> HolderSpec {
    HolderSpec {
        profile: ShellProfile {
            id: "login".into(),
            name: "sh".into(),
            origin: ProfileOrigin::Login,
            kind: ShellKind::Sh,
            path: "/bin/sh".into(),
            args: vec![],
            login: true,
            env: BTreeMap::new(),
            cwd: None,
            integration: Integration::Auto,
        },
        cwd: Some(home.into()),
        env: BTreeMap::new(),
        size: SIZE,
        scrollback_lines: 1_000,
        home: home.into(),
        user: "tester".into(),
        options: Default::default(),
        data_dir: None,
    }
}

fn control(event: &HolderEvent) -> Vec<u8> {
    frame::encode(FrameKind::Control, 0, &serde_json::to_vec(event).unwrap()).unwrap()
}

/// A holder a core adopts: with no protocol in its hello it is one as E1 built it, with one attachment on the session
/// stream, which it answers by echoing input and greeting each attach with its "screen". With a protocol it never
/// answers an attach.
async fn serve_fake_holder(listener: UnixListener, home: String, proto: Option<u32>) {
    loop {
        let Ok((stream, _)) = listener.accept().await else {
            return;
        };
        let (read, write) = stream.into_split();
        let (sender, _writer) = FrameSender::spawn(write);
        let mut reader = FrameReader::new(read);
        sender.send(control(&HolderEvent::Hello {
            spec: Some(Box::new(fake_spec(&home))),
            name: None,
            proto,
        }));
        sender.send(control(&HolderEvent::Status {
            status: HolderStatus {
                state: SessionState::Running,
                pid: Some(1),
                started_at: Some(1),
                last_output_at: None,
                exit: None,
                failure: None,
                title: None,
                cwd: None,
                size: SIZE,
                persistence_failure: None,
            },
        }));
        while let Ok(Some(frame)) = reader.next().await {
            let reply = match frame.kind {
                FrameKind::Control => match serde_json::from_slice(&frame.payload) {
                    Ok(HolderCommand::Attach { attachment: None, .. }) => Some(b"e1-screen ".to_vec()),
                    _ => None,
                },
                FrameKind::Input if frame.stream == SESSION_STREAM => Some(frame.payload),
                _ => None,
            };
            if let Some(bytes) = reply {
                sender.send(frame::encode(FrameKind::Output, SESSION_STREAM, &bytes).unwrap());
            }
        }
    }
}

/// Serves a fake holder for session `id` where the core adopts it at start, until the returned task is aborted.
fn plant_holder(installed: &Installed, id: &str, proto: Option<u32>) -> tokio::task::JoinHandle<()> {
    let holders = installed.root.join("run/holders");
    std::fs::DirBuilder::new()
        .mode(0o700)
        .recursive(true)
        .create(&holders)
        .unwrap();
    std::fs::set_permissions(
        installed.root.join("run"),
        std::os::unix::fs::PermissionsExt::from_mode(0o700),
    )
    .unwrap();
    let listener = UnixListener::bind(holders.join(format!("{id}.sock"))).unwrap();
    tokio::spawn(serve_fake_holder(
        listener,
        installed.home.to_string_lossy().into_owned(),
        proto,
    ))
}

#[tokio::test]
async fn answers_an_attach_that_a_second_attach_replaced_before_the_holder_did() {
    let installed = Installed::new();
    let _holder = plant_holder(&installed, "00000000000000e2", Some(2));
    let core = installed.start_core();
    let mut client = AppClient::greeted_with(&installed.core_socket(), 2).await;
    let id = SessionId("00000000000000e2".into());
    for request_id in [2, 3] {
        client.send(&ClientMessage::Attach {
            request_id,
            session: id.clone(),
            mode: AttachMode::Full,
            from_offset: None,
        });
    }
    client
        .take(|m| {
            matches!(
                m,
                ServerMessage::Error {
                    request_id: Some(2),
                    code: ErrorCode::BadRequest,
                    ..
                }
            )
        })
        .await;
    stop(core);
}

#[tokio::test]
async fn adopts_a_session_whose_holder_an_e1_core_started() {
    let installed = Installed::new();
    let _holder = plant_holder(&installed, "00000000000000e1", None);
    let core = installed.start_core();
    let mut client = AppClient::greeted_with(&installed.core_socket(), 2).await;
    let id = SessionId("00000000000000e1".into());
    let (stream, replay) = attach(&mut client, 2, &id, None).await;
    assert_eq!(replay, None);
    client.until(|c| c.text(stream).contains("e1-screen")).await;
    client.input(stream, "typed");
    client.until(|c| c.text(stream).contains("typed")).await;
    client.send(&ClientMessage::Refresh {
        request_id: 3,
        session: id.clone(),
    });
    client
        .take(|m| {
            matches!(
                m,
                ServerMessage::Error {
                    request_id: Some(3),
                    code: ErrorCode::Unsupported,
                    ..
                }
            )
        })
        .await;
    assert!(
        !client
            .messages
            .iter()
            .any(|m| matches!(m, ServerMessage::Synced { .. }))
    );
    let mut second = AppClient::greeted_with(&installed.core_socket(), 2).await;
    let (other, _) = attach(&mut second, 2, &id, None).await;
    second.until(|c| c.text(other).contains("e1-screen")).await;
    client
        .take(|m| {
            matches!(
                m,
                ServerMessage::Detached {
                    stream: s,
                    reason: DetachReason::AttachedElsewhere,
                    ..
                } if *s == stream
            )
        })
        .await;
    stop(core);
}

#[tokio::test]
async fn restores_a_session_an_e1_or_e2_holder_ran_without_scrollback_once_its_processes_ended() {
    for proto in [None, Some(2)] {
        restores_an_older_holders_session(proto).await;
    }
}

/// Waits up to 10 s until the core has written the session's record.
async fn recorded(client: &mut AppClient, installed: &Installed, id: &SessionId) {
    let record = installed.root.join("sessions").join(&id.0).join("meta.json");
    let started = std::time::Instant::now();
    while !record.exists() {
        assert!(started.elapsed() < Duration::from_secs(10), "the core wrote no record");
        client.pause(Duration::from_millis(20)).await;
    }
}

/// The session as the core lists it once it runs again, within 15 s.
async fn running_again(client: &mut AppClient, id: &SessionId) -> SessionInfo {
    let started = std::time::Instant::now();
    loop {
        client.send(&ClientMessage::ListSessions { request_id: 3 });
        let ServerMessage::Sessions { sessions, .. } = client
            .take(|m| matches!(m, ServerMessage::Sessions { request_id: 3, .. }))
            .await
        else {
            unreachable!()
        };
        match sessions.into_iter().find(|session| &session.id == id) {
            Some(session) if session.state == SessionState::Running => return session,
            listed => assert!(started.elapsed() < Duration::from_secs(15), "{listed:?}"),
        }
        client.pause(Duration::from_millis(100)).await;
    }
}

/// An older holder, which saves nothing to disk, runs a session; once its processes end, a new core restores it below
/// only the marker (P-49).
async fn restores_an_older_holders_session(proto: Option<u32>) {
    let installed = Installed::new();
    let holder = plant_holder(&installed, "00000000000000e1", proto);
    let core = installed.start_core();
    let mut client = AppClient::greeted_with(&installed.core_socket(), 3).await;
    let id = SessionId("00000000000000e1".into());
    recorded(&mut client, &installed, &id).await;
    stop(core);
    holder.abort();
    let _ = holder.await;

    let core = installed.start_core();
    let mut client = AppClient::greeted_with(&installed.core_socket(), 3).await;
    let restored = running_again(&mut client, &id).await;
    assert!(restored.restored.is_some(), "{restored:?}");
    let (stream, _) = attach(&mut client, 4, &id, None).await;
    client
        .until(|c| c.text(stream).contains("Previous processes ended."))
        .await;
    assert!(!client.text(stream).contains("e1-screen"));
    stop(core);
}
