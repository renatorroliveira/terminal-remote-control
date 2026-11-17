//! Managing a host's daemon from the app (US-3.3.2, US-3.3.3): Restart daemon ends only the core, whose successor
//! adopts every session, and Remove daemon stops every session, deletes their data and ends the core.

mod support;

use std::collections::BTreeMap;

use support::{AppClient, Installed, any_matching, stop, wait_child};
use trc_protocol::{
    AttachMode, ClientMessage, CreateSessionSpec, ServerMessage, SessionChange, SessionId, SessionInfo, TerminalSize,
};

fn spec(name: &str) -> CreateSessionSpec {
    CreateSessionSpec {
        profile_id: None,
        cwd: None,
        name: Some(name.into()),
        env: BTreeMap::from([("PS1".into(), Some("$ ".into()))]),
        size: TerminalSize { cols: 80, rows: 24 },
        scrollback_lines: None,
        options: None,
    }
}

async fn create(client: &mut AppClient, request_id: u32, name: &str) -> SessionInfo {
    client.send(&ClientMessage::Create {
        request_id,
        spec: spec(name),
    });
    let ServerMessage::Created { session, .. } = client
        .take(|m| matches!(m, ServerMessage::Created { request_id: r, .. } if *r == request_id))
        .await
    else {
        unreachable!()
    };
    session
}

async fn attach(client: &mut AppClient, request_id: u32, session: &SessionId) -> u32 {
    client.send(&ClientMessage::Attach {
        request_id,
        session: session.clone(),
        mode: AttachMode::Full,
        from_offset: None,
    });
    let ServerMessage::Attached { stream, .. } = client
        .take(|m| matches!(m, ServerMessage::Attached { request_id: r, .. } if *r == request_id))
        .await
    else {
        unreachable!()
    };
    client
        .until(|c| c.text(stream).contains("$ ") || c.text(stream).contains("# "))
        .await;
    stream
}

async fn done(client: &mut AppClient, request_id: u32) {
    client
        .take(|m| matches!(m, ServerMessage::Done { request_id: r } if *r == request_id))
        .await;
}

#[tokio::test]
async fn restart_daemon_ends_only_the_core_and_its_successor_keeps_every_session() {
    let installed = Installed::new();
    let mut core = installed.start_core();
    let mut client = AppClient::greeted_with(&installed.core_socket(), 3).await;
    let session = create(&mut client, 1, "build").await;
    let stream = attach(&mut client, 2, &session.id).await;
    client.input(stream, "echo TRC-BEFORE-$((40+2))\r");
    client.until(|c| c.text(stream).contains("TRC-BEFORE-42")).await;
    client.send(&ClientMessage::RestartDaemon { request_id: 3 });
    done(&mut client, 3).await;
    client.until_closed().await;
    assert!(wait_child(&mut core).success());
    assert!(!installed.core_socket().exists(), "the old core left its socket");

    let core = installed.start_core();
    let mut client = AppClient::greeted_with(&installed.core_socket(), 3).await;
    let stream = attach(&mut client, 4, &session.id).await;
    assert!(client.text(stream).contains("TRC-BEFORE-42"));
    client.input(stream, "echo TRC-AFTER-$((40+2))\r");
    client.until(|c| c.text(stream).contains("TRC-AFTER-42")).await;
    stop(core);
}

#[tokio::test]
async fn remove_daemon_stops_every_session_deletes_their_data_and_ends_the_core() {
    let installed = Installed::new();
    let mut core = installed.start_core();
    let mut client = AppClient::greeted_with(&installed.core_socket(), 3).await;
    let first = create(&mut client, 1, "first").await;
    let second = create(&mut client, 2, "second").await;
    attach(&mut client, 3, &first.id).await;
    let sessions = installed.root.join("sessions");
    assert!(sessions.join(&second.id.0).is_dir());
    client.send(&ClientMessage::RemoveDaemon {
        request_id: 4,
        grace_ms: Some(200),
    });
    client.send(&ClientMessage::Restart {
        request_id: 5,
        session: first.id.clone(),
    });
    let refused = client
        .take(|m| {
            matches!(
                m,
                ServerMessage::Error {
                    request_id: Some(5),
                    ..
                }
            )
        })
        .await;
    assert!(
        matches!(&refused, ServerMessage::Error { message, .. } if message.contains("being removed")),
        "{refused:?}"
    );
    done(&mut client, 4).await;
    let closed: Vec<&SessionId> = client
        .messages
        .iter()
        .filter_map(|message| match message {
            ServerMessage::SessionEvent {
                change: SessionChange::Closed { session_id },
            } => Some(session_id),
            _ => None,
        })
        .collect();
    assert_eq!(closed.len(), 2, "{:?}", client.messages);
    client.until_closed().await;
    assert!(wait_child(&mut core).success());
    assert!(!sessions.exists(), "the sessions folder is still there");
    assert!(!installed.core_socket().exists(), "the core left its socket");
    assert!(
        !any_matching(&format!("{} holder", installed.binary.display())),
        "holders still run"
    );
}
