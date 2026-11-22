//! Shell integration through the core the way the app drives it (US-5.1, P-73): every bash, zsh and fish the host
//! offers starts with TRC's script, marks its prompts and commands with OSC 133, ends a command with its status, and
//! says so in its session; turned off, the same shell marks nothing.
#![cfg(unix)]

mod support;

use std::collections::BTreeMap;

use support::{AppClient, Installed, stop};
use trc_protocol::{
    AttachMode, ClientMessage, CreateSessionSpec, ServerMessage, SessionActivity, SessionChange, SessionId,
    SessionInfo, SessionOptions, ShellIntegration, ShellKind, ShellProfile, TerminalSize,
};

const SIZE: TerminalSize = TerminalSize { cols: 100, rows: 30 };

async fn profiles(client: &mut AppClient) -> Vec<ShellProfile> {
    client.send(&ClientMessage::ListProfiles { request_id: 1 });
    let ServerMessage::Profiles { profiles, .. } = client
        .take(|m| matches!(m, ServerMessage::Profiles { request_id: 1, .. }))
        .await
    else {
        unreachable!()
    };
    profiles
}

/// One profile for each shell kind TRC integrates, as the host offers them.
fn integrated_shells(profiles: Vec<ShellProfile>) -> Vec<ShellProfile> {
    let mut seen = Vec::new();
    profiles
        .into_iter()
        .filter(|profile| matches!(profile.kind, ShellKind::Bash | ShellKind::Zsh | ShellKind::Fish))
        .filter(|profile| {
            let new = !seen.contains(&profile.kind);
            seen.push(profile.kind);
            new
        })
        .collect()
}

async fn create(
    client: &mut AppClient,
    request_id: u32,
    profile: &ShellProfile,
    options: Option<SessionOptions>,
) -> SessionInfo {
    let spec = CreateSessionSpec {
        profile_id: Some(profile.id.clone()),
        cwd: None,
        name: Some(profile.name.clone()),
        env: BTreeMap::new(),
        size: SIZE,
        scrollback_lines: None,
        options,
    };
    client.send(&ClientMessage::Create { request_id, spec });
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
    stream
}

async fn listed(client: &mut AppClient, session: &SessionId) -> SessionInfo {
    client.send(&ClientMessage::ListSessions { request_id: 90 });
    let ServerMessage::Sessions { sessions, .. } = client
        .take(|m| matches!(m, ServerMessage::Sessions { request_id: 90, .. }))
        .await
    else {
        unreachable!()
    };
    sessions.into_iter().find(|info| info.id == *session).unwrap()
}

#[tokio::test]
async fn marks_every_prompt_and_command_of_each_shell_it_integrates_us_5_1() {
    let installed = Installed::new();
    let core = installed.start_core();
    let mut client = AppClient::greeted_with(&installed.core_socket(), 3).await;
    let shells = integrated_shells(profiles(&mut client).await);
    assert!(!shells.is_empty(), "no bash, zsh or fish on this host");
    for (index, profile) in shells.iter().enumerate() {
        let base = 10 + 10 * u32::try_from(index).unwrap();
        let session = create(&mut client, base, profile, None).await;
        let stream = attach(&mut client, base + 1, &session.id).await;
        client.until(|c| c.text(stream).contains("\x1b]133;A")).await;
        client.input(stream, "false\r");
        client.until(|c| c.text(stream).contains("\x1b]133;C")).await;
        client.until(|c| c.text(stream).contains("\x1b]133;D;1")).await;
        assert_eq!(
            listed(&mut client, &session.id).await.integration,
            Some(ShellIntegration::Injected),
            "{}",
            profile.path
        );
    }
    stop(core);
}

#[tokio::test]
async fn starts_the_shell_without_integration_when_the_session_turns_it_off_us_5_1_3() {
    let installed = Installed::new();
    let core = installed.start_core();
    let mut client = AppClient::greeted_with(&installed.core_socket(), 3).await;
    let shell = integrated_shells(profiles(&mut client).await).remove(0);
    let off = SessionOptions {
        integration: Some(false),
        ..SessionOptions::default()
    };
    let session = create(&mut client, 10, &shell, Some(off)).await;
    let stream = attach(&mut client, 11, &session.id).await;
    client.input(stream, "echo TRC-OFF-$((40+2))\r");
    client.until(|c| c.text(stream).contains("TRC-OFF-42")).await;
    assert!(!client.text(stream).contains("\x1b]133;"), "{:?}", client.text(stream));
    assert_eq!(
        listed(&mut client, &session.id).await.integration,
        Some(ShellIntegration::Off)
    );
    stop(core);
}

#[tokio::test]
async fn applies_a_change_of_the_option_when_the_shell_next_starts_us_5_1_3() {
    let installed = Installed::new();
    let core = installed.start_core();
    let mut client = AppClient::greeted_with(&installed.core_socket(), 3).await;
    let shell = integrated_shells(profiles(&mut client).await).remove(0);
    let session = create(&mut client, 10, &shell, None).await;
    let stream = attach(&mut client, 11, &session.id).await;
    client.until(|c| c.text(stream).contains("\x1b]133;A")).await;
    let off = SessionOptions {
        integration: Some(false),
        ..SessionOptions::default()
    };
    client.send(&ClientMessage::SetSessionOptions {
        request_id: 12,
        session: session.id.clone(),
        options: off,
    });
    client
        .take(|m| matches!(m, ServerMessage::Done { request_id: 12 }))
        .await;
    assert_eq!(
        listed(&mut client, &session.id).await.integration,
        Some(ShellIntegration::Injected)
    );
    client.send(&ClientMessage::Restart {
        request_id: 13,
        session: session.id.clone(),
    });
    client
        .take(|m| matches!(m, ServerMessage::Done { request_id: 13 }))
        .await;
    client.until(|c| c.text(stream).contains("[Restarted at ")).await;
    let restarted = client.text(stream).rfind("[Restarted at ").unwrap();
    client.input(stream, "echo TRC-AFTER-$((40+2))\r");
    client.until(|c| c.text(stream).contains("TRC-AFTER-42")).await;
    assert!(!client.text(stream)[restarted..].contains("\x1b]133;A"));
    assert_eq!(
        listed(&mut client, &session.id).await.integration,
        Some(ShellIntegration::Off)
    );
    stop(core);
}

#[tokio::test]
async fn tells_protocol_4_clients_when_a_command_finishes_and_older_ones_nothing_us_5_3() {
    let installed = Installed::new();
    let core = installed.start_core();
    let mut client = AppClient::greeted_with(&installed.core_socket(), 4).await;
    let mut older = AppClient::greeted_with(&installed.core_socket(), 3).await;
    let shell = integrated_shells(profiles(&mut client).await).remove(0);
    let session = create(&mut client, 10, &shell, None).await;
    let stream = attach(&mut client, 11, &session.id).await;
    client.until(|c| c.text(stream).contains("\x1b]133;A")).await;
    client.input(stream, "printf '\\a'; false\r");
    let activity = |m: &ServerMessage| {
        matches!(
            m,
            ServerMessage::SessionEvent {
                change: SessionChange::Activity { .. }
            }
        )
    };
    let ServerMessage::SessionEvent {
        change: SessionChange::Activity {
            session_id,
            activity: finished,
        },
    } = client
        .take(|m| {
            matches!(
                m,
                ServerMessage::SessionEvent {
                    change: SessionChange::Activity {
                        activity: SessionActivity::CommandFinished { .. },
                        ..
                    }
                }
            )
        })
        .await
    else {
        unreachable!()
    };
    assert_eq!(session_id, session.id);
    assert!(
        matches!(finished, SessionActivity::CommandFinished { exit_code: Some(1), .. }),
        "{finished:?}"
    );
    client
        .take(|m| {
            matches!(
                m,
                ServerMessage::SessionEvent {
                    change: SessionChange::Activity {
                        activity: SessionActivity::Bell,
                        ..
                    }
                }
            )
        })
        .await;
    older.pause(std::time::Duration::from_millis(500)).await;
    assert!(!older.messages.iter().any(activity), "{:?}", older.messages);
    stop(core);
}
