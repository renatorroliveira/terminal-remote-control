//! `trcd core` driven over its socket the way the app drives it through the bridge
//! (US-1.4.6, US-1.5.1, US-1.7, US-1.9, US-1.10, SEC-02, SEC-04.4, SEC-08, NFR-09).

mod support;

use std::collections::BTreeMap;
use std::os::unix::fs::{MetadataExt, PermissionsExt};

use support::{AppClient, Installed, stop, wait_child};
use trc_protocol::{
    AttachMode, ClientMessage, CreateSessionSpec, ErrorCode, ServerMessage, SessionChange, SessionId, SessionInfo,
    SessionState, TerminalSize,
};

const SIZE: TerminalSize = TerminalSize { cols: 100, rows: 30 };

fn create_spec(name: Option<&str>) -> CreateSessionSpec {
    CreateSessionSpec {
        profile_id: None,
        cwd: None,
        name: name.map(str::to_owned),
        env: BTreeMap::from([("PS1".into(), Some("$ ".into()))]),
        size: SIZE,
        scrollback_lines: None,
    }
}

async fn create(client: &mut AppClient, request_id: u32, name: Option<&str>) -> SessionInfo {
    client.send(&ClientMessage::Create {
        request_id,
        spec: create_spec(name),
    });
    let ServerMessage::Created { session, .. } = client
        .take(|m| matches!(m, ServerMessage::Created { request_id: r, .. } if *r == request_id))
        .await
    else {
        unreachable!()
    };
    session
}

async fn until_state(client: &mut AppClient, id: &SessionId, state: SessionState) -> SessionInfo {
    let wanted = |m: &ServerMessage| {
        matches!(m, ServerMessage::SessionEvent { change: SessionChange::Updated { session } }
            if &session.id == id && session.state == state)
    };
    let ServerMessage::SessionEvent {
        change: SessionChange::Updated { session },
    } = client.take(wanted).await
    else {
        unreachable!()
    };
    session
}

async fn attach(client: &mut AppClient, request_id: u32, id: &SessionId) -> u32 {
    client.send(&ClientMessage::Attach {
        request_id,
        session: id.clone(),
        mode: AttachMode::Full,
    });
    let ServerMessage::Attached { stream, credit, .. } = client
        .take(|m| matches!(m, ServerMessage::Attached { request_id: r, .. } if *r == request_id))
        .await
    else {
        unreachable!()
    };
    assert_eq!(credit, 256 * 1024);
    stream
}

async fn done(client: &mut AppClient, request_id: u32) {
    client
        .take(|m| matches!(m, ServerMessage::Done { request_id: r } if *r == request_id))
        .await;
}

/// Whether a shell prompt arrived: `$ ` from the test's `PS1`, or `# ` when a root login shell's profile sets it.
fn prompted(text: &str) -> bool {
    text.contains("$ ") || text.contains("# ")
}

async fn running_session(client: &mut AppClient, name: Option<&str>) -> (SessionId, u32) {
    let session = create(client, 1, name).await;
    until_state(client, &session.id, SessionState::Running).await;
    let stream = attach(client, 2, &session.id).await;
    client.until(|c| prompted(&c.text(stream))).await;
    (session.id, stream)
}

#[tokio::test]
async fn greets_with_the_version_and_the_binary_checksum() {
    let installed = Installed::new();
    let core = installed.start_core();
    let mut client = AppClient::connect(&installed.core_socket()).await;
    client.send(&ClientMessage::Hello {
        min_proto: 1,
        max_proto: 3,
        app_version: "0".into(),
        caps: vec![],
    });
    let welcome = client.take(|m| matches!(m, ServerMessage::Welcome { .. })).await;
    let ServerMessage::Welcome {
        proto,
        daemon_version,
        binary_sha256,
        ..
    } = welcome
    else {
        unreachable!()
    };
    assert_eq!(proto, 1);
    assert_eq!(daemon_version, env!("CARGO_PKG_VERSION"));
    assert_eq!(binary_sha256, trcd::digest::sha256_file(&installed.binary).unwrap());
    stop(core);
}

#[tokio::test]
async fn refuses_an_app_without_a_common_protocol_version() {
    let installed = Installed::new();
    let core = installed.start_core();
    let mut client = AppClient::connect(&installed.core_socket()).await;
    client.send(&ClientMessage::Hello {
        min_proto: 2,
        max_proto: 3,
        app_version: "9".into(),
        caps: vec![],
    });
    let refusal = client.take(|m| matches!(m, ServerMessage::Incompatible { .. })).await;
    assert_eq!(
        refusal,
        ServerMessage::Incompatible {
            min_proto: 1,
            max_proto: 1
        }
    );
    client.until_closed().await;
    stop(core);
}

#[tokio::test]
async fn requires_the_handshake_first() {
    let installed = Installed::new();
    let core = installed.start_core();
    let mut client = AppClient::connect(&installed.core_socket()).await;
    client.send(&ClientMessage::Ping { request_id: 1 });
    let error = client.take(|m| matches!(m, ServerMessage::Error { .. })).await;
    assert!(
        matches!(
            error,
            ServerMessage::Error {
                code: ErrorCode::BadRequest,
                ..
            }
        ),
        "{error:?}"
    );
    client.until_closed().await;
    stop(core);
}

#[tokio::test]
async fn lists_the_login_shell_first() {
    let installed = Installed::new();
    let core = installed.start_core();
    let mut client = AppClient::greeted(&installed.core_socket()).await;
    client.send(&ClientMessage::ListProfiles { request_id: 4 });
    let ServerMessage::Profiles { profiles, .. } = client.take(|m| matches!(m, ServerMessage::Profiles { .. })).await
    else {
        unreachable!()
    };
    assert_eq!(
        (profiles[0].id.as_str(), profiles[0].path.as_str()),
        ("login", "/bin/sh")
    );
    stop(core);
}

#[tokio::test]
async fn runs_a_session_and_relays_input_and_output() {
    let installed = Installed::new();
    let core = installed.start_core();
    let mut client = AppClient::greeted(&installed.core_socket()).await;
    let created = create(&mut client, 1, None).await;
    assert_eq!(created.state, SessionState::Starting);
    assert_eq!(created.profile.id, "login");
    assert_eq!(created.cwd.as_deref(), Some(installed.home.to_str().unwrap()));
    let running = until_state(&mut client, &created.id, SessionState::Running).await;
    assert!(running.pid.is_some() && running.started_at.is_some());
    let stream = attach(&mut client, 2, &created.id).await;
    client.until(|c| prompted(&c.text(stream))).await;
    client.input(stream, "echo trc-$((6*7)) $HOME\r");
    client
        .until(|c| c.text(stream).contains(&format!("trc-42 {}", installed.home.display())))
        .await;
    client.send(&ClientMessage::Resize {
        request_id: 3,
        session: created.id.clone(),
        size: TerminalSize { cols: 120, rows: 40 },
    });
    done(&mut client, 3).await;
    client.input(stream, "stty size\r");
    client.until(|c| c.text(stream).contains("40 120")).await;
    stop(core);
}

#[tokio::test]
async fn renames_reorders_and_lists_sessions() {
    let installed = Installed::new();
    let core = installed.start_core();
    let mut client = AppClient::greeted(&installed.core_socket()).await;
    let first = create(&mut client, 1, Some("first")).await;
    let second = create(&mut client, 2, None).await;
    client.send(&ClientMessage::Rename {
        request_id: 3,
        session: second.id.clone(),
        name: Some("build".into()),
    });
    done(&mut client, 3).await;
    client.send(&ClientMessage::Reorder {
        request_id: 4,
        session: second.id.clone(),
        index: 0,
    });
    done(&mut client, 4).await;
    let reordered = client
        .take(|m| {
            matches!(
                m,
                ServerMessage::SessionEvent {
                    change: SessionChange::Reordered { .. }
                }
            )
        })
        .await;
    let ServerMessage::SessionEvent {
        change: SessionChange::Reordered { order },
    } = reordered
    else {
        unreachable!()
    };
    assert_eq!(order, vec![second.id.clone(), first.id.clone()]);
    client.send(&ClientMessage::ListSessions { request_id: 5 });
    let ServerMessage::Sessions { sessions, .. } = client.take(|m| matches!(m, ServerMessage::Sessions { .. })).await
    else {
        unreachable!()
    };
    let summary: Vec<(Option<&str>, u32)> = sessions.iter().map(|s| (s.custom_name.as_deref(), s.order)).collect();
    assert_eq!(summary, vec![(Some("build"), 0), (Some("first"), 1)]);
    client.send(&ClientMessage::Rename {
        request_id: 6,
        session: SessionId("0000000000000000".into()),
        name: None,
    });
    let error = client.take(|m| matches!(m, ServerMessage::Error { .. })).await;
    assert!(matches!(
        error,
        ServerMessage::Error {
            request_id: Some(6),
            code: ErrorCode::UnknownSession,
            ..
        }
    ));
    stop(core);
}

#[tokio::test]
async fn stops_restarts_and_closes_a_session() {
    let installed = Installed::new();
    let core = installed.start_core();
    let mut client = AppClient::greeted(&installed.core_socket()).await;
    let (id, stream) = running_session(&mut client, None).await;
    client.send(&ClientMessage::Stop {
        request_id: 3,
        session: id.clone(),
        grace_ms: Some(200),
    });
    done(&mut client, 3).await;
    let stopped = until_state(&mut client, &id, SessionState::Stopped).await;
    assert!(stopped.exit.is_some());
    client.send(&ClientMessage::Restart {
        request_id: 4,
        session: id.clone(),
    });
    done(&mut client, 4).await;
    until_state(&mut client, &id, SessionState::Running).await;
    client.until(|c| c.text(stream).contains("[Restarted at ")).await;
    let holder_socket = installed.root.join(format!("run/holders/{}.sock", id.0));
    assert!(holder_socket.exists());
    client.send(&ClientMessage::Close {
        request_id: 5,
        session: id.clone(),
    });
    done(&mut client, 5).await;
    let closed = client
        .take(|m| matches!(m, ServerMessage::SessionEvent { change: SessionChange::Closed { session_id } } if *session_id == id))
        .await;
    assert!(matches!(closed, ServerMessage::SessionEvent { .. }));
    assert!(!holder_socket.exists());
    stop(core);
}

#[tokio::test]
async fn sessions_survive_a_core_crash_and_are_adopted_by_the_next_core() {
    let installed = Installed::new();
    let core = installed.start_core();
    let mut client = AppClient::greeted(&installed.core_socket()).await;
    let (id, stream) = running_session(&mut client, Some("survivor")).await;
    client.input(stream, "echo before-crash\r");
    client.until(|c| c.text(stream).contains("before-crash\r\n")).await;
    stop(core);
    client.until_closed().await;

    let next = installed.start_core();
    let mut client = AppClient::greeted(&installed.core_socket()).await;
    client.send(&ClientMessage::ListSessions { request_id: 1 });
    let ServerMessage::Sessions { sessions, .. } = client.take(|m| matches!(m, ServerMessage::Sessions { .. })).await
    else {
        unreachable!()
    };
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].id, id);
    assert_eq!(sessions[0].custom_name.as_deref(), Some("survivor"));
    assert_eq!(sessions[0].state, SessionState::Running);
    let stream = attach(&mut client, 2, &id).await;
    client.until(|c| c.text(stream).contains("before-crash")).await;
    client.input(stream, "echo after-crash\r");
    client.until(|c| c.text(stream).contains("after-crash\r\n")).await;
    stop(next);
}

#[tokio::test]
async fn removes_stale_holder_sockets_and_a_stale_core_socket() {
    let installed = Installed::new();
    let first = installed.start_core();
    stop(first);
    let holders = installed.root.join("run/holders");
    let stale = holders.join("0123456789abcdef.sock");
    drop(std::os::unix::net::UnixListener::bind(&stale).unwrap());
    let core = installed.start_core();
    let mut client = AppClient::greeted(&installed.core_socket()).await;
    client.send(&ClientMessage::ListSessions { request_id: 1 });
    let sessions = client.take(|m| matches!(m, ServerMessage::Sessions { .. })).await;
    assert_eq!(
        sessions,
        ServerMessage::Sessions {
            request_id: 1,
            sessions: vec![]
        }
    );
    assert!(!stale.exists());
    stop(core);
}

#[test]
fn only_one_core_runs_per_user() {
    let installed = Installed::new();
    let core = installed.start_core();
    let mut second = installed.command(&["core"]).spawn().unwrap();
    assert_eq!(wait_child(&mut second).code(), Some(75));
    stop(core);
}

#[test]
fn refuses_to_start_from_an_install_others_can_write() {
    let installed = Installed::new();
    std::fs::set_permissions(&installed.binary, std::fs::Permissions::from_mode(0o722)).unwrap();
    let output = installed.command(&["core"]).output().unwrap();
    assert_eq!(output.status.code(), Some(78));
    assert!(String::from_utf8_lossy(&output.stderr).contains("writable by group or others"));
}

#[tokio::test]
async fn keeps_private_files_and_logs_without_terminal_content() {
    let installed = Installed::new();
    let core = installed.start_core();
    let mut client = AppClient::greeted(&installed.core_socket()).await;
    let (id, stream) = running_session(&mut client, None).await;
    client.input(stream, "echo canary-$((1+1))-5e1f\r");
    client.until(|c| c.text(stream).contains("canary-2-5e1f\r\n")).await;
    client.send(&ClientMessage::Close {
        request_id: 9,
        session: id,
    });
    done(&mut client, 9).await;
    stop(core);
    let mode = |path: &std::path::Path| std::fs::metadata(path).unwrap().mode() & 0o777;
    assert_eq!(mode(&installed.root.join("run")), 0o700);
    assert_eq!(mode(&installed.root.join("run/holders")), 0o700);
    assert_eq!(mode(&installed.root.join("logs")), 0o700);
    let logs: Vec<_> = std::fs::read_dir(installed.root.join("logs"))
        .unwrap()
        .map(|e| e.unwrap().path())
        .collect();
    assert!(!logs.is_empty());
    let text: String = logs
        .iter()
        .map(|path| {
            assert_eq!(mode(path), 0o600, "{}", path.display());
            std::fs::read_to_string(path).unwrap()
        })
        .collect();
    assert!(text.contains("session created"), "{text}");
    assert!(!text.contains("canary-2-5e1f"), "{text}");
}
