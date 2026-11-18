//! Sessions saved to disk as they run, through the core the way the app drives it (US-3.1.2, US-3.2, NFR-08,
//! SEC-05): every session gets a private data folder whose scrollback file follows its output within seconds, Clear
//! scrollback rewrites it, turning saving off deletes it, and closing the session deletes the folder.

mod support;

use std::collections::BTreeMap;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use support::{AppClient, Installed, stop};
use trc_protocol::{
    AttachMode, ClientMessage, CreateSessionSpec, ServerMessage, SessionChange, SessionInfo, SessionOptions,
    TerminalSize,
};
use trcd::holder::scrollback_file::{FILE_NAME, read};

const SIZE: TerminalSize = TerminalSize { cols: 80, rows: 24 };
/// NFR-08's bound on how far the file may lag behind the output.
const DURABILITY: Duration = Duration::from_secs(5);

async fn running(client: &mut AppClient, options: Option<SessionOptions>) -> (SessionInfo, u32) {
    client.send(&ClientMessage::Create {
        request_id: 1,
        spec: CreateSessionSpec {
            profile_id: None,
            cwd: None,
            name: None,
            env: BTreeMap::from([("PS1".into(), Some("$ ".into()))]),
            size: SIZE,
            scrollback_lines: None,
            options,
        },
    });
    let ServerMessage::Created { session, .. } = client
        .take(|m| matches!(m, ServerMessage::Created { request_id: 1, .. }))
        .await
    else {
        unreachable!()
    };
    client.send(&ClientMessage::Attach {
        request_id: 2,
        session: session.id.clone(),
        mode: AttachMode::Full,
        from_offset: None,
    });
    let ServerMessage::Attached { stream, .. } = client
        .take(|m| matches!(m, ServerMessage::Attached { request_id: 2, .. }))
        .await
    else {
        unreachable!()
    };
    client.until(|c| prompted(&c.text(stream))).await;
    (session, stream)
}

/// Whether a shell prompt arrived: `$ ` from the test's `PS1`, or `# ` when a root login shell's profile sets it.
fn prompted(text: &str) -> bool {
    text.contains("$ ") || text.contains("# ")
}

fn data_dir(installed: &Installed, session: &SessionInfo) -> PathBuf {
    installed.root.join("sessions").join(&session.id.0)
}

/// The text the scrollback file holds: its history, then its last screen.
fn saved_text(dir: &Path) -> String {
    let Ok(file) = std::fs::File::open(dir.join(FILE_NAME)) else {
        return String::new();
    };
    let mut bytes = Vec::new();
    let recovered = read(file, |history| bytes.extend_from_slice(history)).unwrap();
    bytes.extend(recovered.screen.unwrap_or_default());
    String::from_utf8_lossy(&bytes).into_owned()
}

async fn until_saved(client: &mut AppClient, dir: &Path, wanted: impl Fn(&str) -> bool) -> Duration {
    let started = Instant::now();
    while !wanted(&saved_text(dir)) {
        assert!(
            started.elapsed() < Duration::from_secs(15),
            "not saved: {}",
            saved_text(dir)
        );
        client.pause(Duration::from_millis(100)).await;
    }
    started.elapsed()
}

#[tokio::test]
async fn saves_a_session_to_its_private_folder_within_seconds_of_its_output() {
    let installed = Installed::new();
    let core = installed.start_core();
    let mut client = AppClient::greeted_with(&installed.core_socket(), 3).await;
    let (session, stream) = running(&mut client, None).await;
    assert_eq!(session.options, Some(SessionOptions::default()));
    let dir = data_dir(&installed, &session);
    let mode = |path: &Path| std::fs::metadata(path).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode(&dir), 0o700);
    client.input(stream, "seq 1 300; echo TRC-SAVED-$((40+2))\r");
    let lag = until_saved(&mut client, &dir, |text| {
        text.contains("TRC-SAVED-42") && text.contains("\n150")
    })
    .await;
    assert!(lag < DURABILITY, "saved after {lag:?}");
    assert_eq!(mode(&dir.join(FILE_NAME)), 0o600);
    client.send(&ClientMessage::Close {
        request_id: 3,
        session: session.id.clone(),
    });
    client
        .take(|m| {
            matches!(
                m,
                ServerMessage::SessionEvent {
                    change: SessionChange::Closed { .. }
                }
            )
        })
        .await;
    let closed = Instant::now();
    while dir.exists() {
        assert!(
            closed.elapsed() < Duration::from_secs(5),
            "the closed session's folder stayed"
        );
        client.pause(Duration::from_millis(20)).await;
    }
    stop(core);
}

#[tokio::test]
async fn clears_the_saved_scrollback_and_deletes_it_when_saving_stops() {
    let installed = Installed::new();
    let core = installed.start_core();
    let mut client = AppClient::greeted_with(&installed.core_socket(), 3).await;
    let (session, stream) = running(&mut client, None).await;
    let dir = data_dir(&installed, &session);
    client.input(stream, "seq 1 300\r");
    until_saved(&mut client, &dir, |text| text.contains("\n150")).await;
    client.send(&ClientMessage::ClearScrollback {
        request_id: 4,
        session: session.id.clone(),
    });
    client
        .take(|m| matches!(m, ServerMessage::Done { request_id: 4 }))
        .await;
    client.until(|c| c.text(stream).contains("\x1b[3J")).await;
    until_saved(&mut client, &dir, |text| !text.contains("\n150")).await;
    let off = SessionOptions {
        restore: true,
        save_scrollback: false,
        integration: None,
    };
    client.send(&ClientMessage::SetSessionOptions {
        request_id: 5,
        session: session.id.clone(),
        options: off,
    });
    client
        .take(|m| matches!(m, ServerMessage::Done { request_id: 5 }))
        .await;
    let updated = client
        .take(|m| matches!(m, ServerMessage::SessionEvent { change: SessionChange::Updated { session } } if session.options == Some(off)))
        .await;
    assert!(matches!(updated, ServerMessage::SessionEvent { .. }));
    let started = Instant::now();
    while dir.join(FILE_NAME).exists() {
        assert!(started.elapsed() < Duration::from_secs(5), "the scrollback file stayed");
        client.pause(Duration::from_millis(50)).await;
    }
    stop(core);
}

#[tokio::test]
async fn saves_nothing_for_a_session_created_with_saving_off() {
    let installed = Installed::new();
    let core = installed.start_core();
    let mut client = AppClient::greeted_with(&installed.core_socket(), 3).await;
    let off = SessionOptions {
        restore: true,
        save_scrollback: false,
        integration: None,
    };
    let (session, stream) = running(&mut client, Some(off)).await;
    client.input(stream, "echo secret-$((1+1))\r");
    client.until(|c| c.text(stream).contains("secret-2")).await;
    client.pause(Duration::from_secs(3)).await;
    assert!(!data_dir(&installed, &session).join(FILE_NAME).exists());
    stop(core);
}
