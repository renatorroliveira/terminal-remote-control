//! Sessions brought back after their processes ended (US-3.1, US-3.2.1, P-40, P-41), through the core the way the
//! app drives it: a killed holder is restored in place, and a core that starts after every process ended, as after
//! a reboot or a logout that ends user processes, restores the saved sessions in their order or keeps them ended.
#![cfg(unix)]

mod support;

use std::collections::BTreeMap;
use std::path::Path;
use std::time::{Duration, Instant};

use support::{AppClient, Installed, kill_matching, stop};
use trc_protocol::{
    AttachMode, ClientMessage, CreateSessionSpec, EndCause, ServerMessage, SessionChange, SessionId, SessionInfo,
    SessionOptions, SessionState, TerminalSize,
};

const SIZE: TerminalSize = TerminalSize { cols: 80, rows: 24 };
/// How many holder endings within ten minutes leave a session failed (`crates/trcd/src/core/relaunch.rs`).
const MAX_ENDINGS: usize = 3;
const OFF: SessionOptions = SessionOptions {
    restore: false,
    save_scrollback: true,
    integration: None,
};

fn spec(name: &str, cwd: Option<&Path>, options: Option<SessionOptions>) -> CreateSessionSpec {
    CreateSessionSpec {
        profile_id: None,
        cwd: cwd.map(|cwd| cwd.to_string_lossy().into_owned()),
        name: Some(name.into()),
        env: BTreeMap::from([("PS1".into(), Some("$ ".into()))]),
        size: SIZE,
        scrollback_lines: None,
        options,
    }
}

async fn create(client: &mut AppClient, request_id: u32, spec: CreateSessionSpec) -> SessionInfo {
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
    client.until(|c| prompted(&c.text(stream))).await;
    stream
}

/// Whether a shell prompt arrived: `$ ` from the test's `PS1`, or `# ` when a root login shell's profile sets it.
fn prompted(text: &str) -> bool {
    text.contains("$ ") || text.contains("# ")
}

/// Prints a marker in the session and waits until the scrollback file holds it, so it is saved (NFR-08).
async fn print_saved(client: &mut AppClient, installed: &Installed, stream: u32, session: &SessionId, marker: &str) {
    client.input(stream, &format!("echo {marker}-$((40+2))\r"));
    let file = installed.root.join("sessions").join(&session.0).join("scrollback.log");
    let wanted = format!("{marker}-42");
    let started = Instant::now();
    while !std::fs::read(&file).is_ok_and(|bytes| String::from_utf8_lossy(&bytes).contains(&wanted)) {
        assert!(started.elapsed() < Duration::from_secs(15), "{marker} was not saved");
        client.pause(Duration::from_millis(100)).await;
    }
}

/// Kills every holder of this install at once, as a reboot or a logout that ends user processes does, and waits until
/// each is gone, so the next core never meets one that is still dying.
fn kill_holders(installed: &Installed) {
    let pattern = format!("{} holder", installed.binary.display());
    let holders = pids_matching(&pattern);
    kill_matching(&pattern);
    let started = Instant::now();
    while holders
        .iter()
        .any(|pid| rustix::process::test_kill_process(*pid).is_ok())
    {
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "a killed holder kept running"
        );
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// The processes whose command line contains `pattern`, from `pgrep`.
fn pids_matching(pattern: &str) -> Vec<rustix::process::Pid> {
    let output = std::process::Command::new("pgrep").args(["-f", pattern]).output();
    String::from_utf8_lossy(&output.map(|output| output.stdout).unwrap_or_default())
        .lines()
        .filter_map(|line| line.trim().parse::<i32>().ok())
        .filter_map(rustix::process::Pid::from_raw)
        .collect()
}

async fn until_updated(client: &mut AppClient, wanted: impl Fn(&SessionInfo) -> bool) -> SessionInfo {
    let ServerMessage::SessionEvent {
        change: SessionChange::Updated { session },
    } = client
        .take(|m| matches!(m, ServerMessage::SessionEvent { change: SessionChange::Updated { session } } if wanted(session)))
        .await
    else {
        unreachable!()
    };
    session
}

async fn listed(client: &mut AppClient) -> Vec<SessionInfo> {
    client.send(&ClientMessage::ListSessions { request_id: 90 });
    let ServerMessage::Sessions { sessions, .. } = client
        .take(|m| matches!(m, ServerMessage::Sessions { request_id: 90, .. }))
        .await
    else {
        unreachable!()
    };
    sessions
}

#[tokio::test]
async fn restores_a_session_whose_holder_was_killed_with_its_scrollback_below_a_marker() {
    let installed = Installed::new();
    let core = installed.start_core();
    let mut client = AppClient::greeted_with(&installed.core_socket(), 3).await;
    let session = create(&mut client, 1, spec("build", None, None)).await;
    let stream = attach(&mut client, 2, &session.id).await;
    print_saved(&mut client, &installed, stream, &session.id, "TRC-BEFORE").await;
    kill_holders(&installed);
    let restored = until_updated(&mut client, |info| info.restored.is_some()).await;
    assert_eq!(restored.custom_name.as_deref(), Some("build"));
    assert!(!restored.restored.unwrap().after_host_restart);
    let running = until_updated(&mut client, |info| info.state == SessionState::Running).await;
    let stream = attach(&mut client, 3, &session.id).await;
    let text = client.text(stream);
    assert!(text.contains("TRC-BEFORE-42"), "{text}");
    assert!(text.contains("Session restored on "), "{text}");
    assert!(text.contains("Previous processes ended."), "{text}");
    client.input(stream, "echo TRC-AFTER-$((40+2))\r");
    client.until(|c| c.text(stream).contains("TRC-AFTER-42")).await;
    assert!(running.pid.is_some());
    stop(core);
}

#[tokio::test]
async fn brings_back_every_session_in_its_order_when_the_core_starts_after_all_processes_ended() {
    let installed = Installed::new();
    let core = installed.start_core();
    let mut client = AppClient::greeted_with(&installed.core_socket(), 3).await;
    let folder = installed.base.join("work");
    std::fs::create_dir(&folder).unwrap();
    let first = create(&mut client, 1, spec("first", Some(&folder), None)).await;
    let kept = create(&mut client, 2, spec("kept", None, Some(OFF))).await;
    let stopped = create(&mut client, 3, spec("stopped", None, None)).await;
    let stream = attach(&mut client, 4, &first.id).await;
    print_saved(&mut client, &installed, stream, &first.id, "TRC-FIRST").await;
    let kept_stream = attach(&mut client, 5, &kept.id).await;
    print_saved(&mut client, &installed, kept_stream, &kept.id, "TRC-KEPT").await;
    client.send(&ClientMessage::Reorder {
        request_id: 6,
        session: stopped.id.clone(),
        index: 0,
    });
    client.send(&ClientMessage::Stop {
        request_id: 7,
        session: stopped.id.clone(),
        grace_ms: Some(100),
    });
    until_updated(&mut client, |info| {
        info.id == stopped.id && info.state == SessionState::Stopped
    })
    .await;
    stop(core);
    kill_holders(&installed);
    std::fs::remove_dir(&folder).unwrap();

    let core = installed.start_core();
    let mut client = AppClient::greeted_with(&installed.core_socket(), 3).await;
    let sessions = listed(&mut client).await;
    let names: Vec<Option<&str>> = sessions.iter().map(|info| info.custom_name.as_deref()).collect();
    assert_eq!(names, [Some("stopped"), Some("first"), Some("kept")]);
    assert_eq!(sessions[0].state, SessionState::Stopped);
    assert!(sessions[1].restored.is_some());
    assert_eq!(sessions[2].state, SessionState::Exited);
    assert_eq!(
        sessions[2].exit.as_ref().and_then(|exit| exit.ended),
        Some(EndCause::ProcessesEnded)
    );
    let stream = attach(&mut client, 8, &first.id).await;
    let text = client.text(stream);
    assert!(
        text.contains("TRC-FIRST-42") && text.contains("Session restored on "),
        "{text}"
    );
    assert!(text.contains("no longer exists"), "{text}");
    client.input(stream, "pwd\r");
    let home = installed.home.to_string_lossy().into_owned();
    client.until(|c| c.text(stream).contains(&home)).await;
    let kept_text = attach_text(&mut client, 9, &kept.id).await;
    assert!(
        kept_text.contains("TRC-KEPT-42") && kept_text.contains("its processes ended"),
        "{kept_text}"
    );
    stop(core);
}

#[tokio::test]
async fn restores_a_session_again_when_its_processes_end_moments_after_a_restore() {
    let installed = Installed::new();
    let core = installed.start_core();
    let mut client = AppClient::greeted_with(&installed.core_socket(), 3).await;
    let session = create(&mut client, 1, spec("flaky", None, None)).await;
    attach(&mut client, 2, &session.id).await;
    kill_holders(&installed);
    let first = until_updated(&mut client, |info| {
        info.state == SessionState::Running && info.restored.is_some()
    })
    .await;
    kill_holders(&installed);
    let again = until_updated(&mut client, |info| {
        info.state == SessionState::Running && info.restored.is_some_and(|at| Some(at) != first.restored)
    })
    .await;
    assert!(again.pid.is_some());
    stop(core);
}

/// Attaches without waiting for a prompt, for a session that runs no shell, and returns what the snapshot showed.
async fn attach_text(client: &mut AppClient, request_id: u32, session: &SessionId) -> String {
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
        .take(|m| matches!(m, ServerMessage::Synced { stream: s, .. } if *s == stream))
        .await;
    client.text(stream)
}

#[tokio::test]
async fn leaves_failed_a_session_whose_holder_keeps_ending_until_restarted_below_its_saved_scrollback() {
    let installed = Installed::new();
    let core = installed.start_core();
    let mut client = AppClient::greeted_with(&installed.core_socket(), 3).await;
    let session = create(&mut client, 1, spec("crashing", None, None)).await;
    let stream = attach(&mut client, 2, &session.id).await;
    print_saved(&mut client, &installed, stream, &session.id, "TRC-SAVED").await;
    let mut restored = None;
    for _ in 1..MAX_ENDINGS {
        kill_holders(&installed);
        let info = until_updated(&mut client, |info| {
            info.state == SessionState::Running && info.restored.is_some() && info.restored != restored
        })
        .await;
        restored = info.restored;
    }
    kill_holders(&installed);
    let failed = until_updated(&mut client, |info| info.state == SessionState::FailedToStart).await;
    assert!(failed.failure.unwrap_or_default().contains("kept ending"));
    client.send(&ClientMessage::Restart {
        request_id: 4,
        session: session.id.clone(),
    });
    until_updated(&mut client, |info| info.state == SessionState::Running).await;
    let stream = attach(&mut client, 5, &session.id).await;
    let text = client.text(stream);
    assert!(
        text.contains("TRC-SAVED-42") && text.contains("[Restarted at "),
        "{text}"
    );
    stop(core);
}

#[tokio::test]
async fn deletes_the_sessions_closed_before_the_core_ended_whether_or_not_their_holder_still_runs() {
    let installed = Installed::new();
    let core = installed.start_core();
    let mut client = AppClient::greeted_with(&installed.core_socket(), 3).await;
    let running = create(&mut client, 1, spec("running", None, None)).await;
    let ended = create(&mut client, 2, spec("ended", None, None)).await;
    let kept = create(&mut client, 3, spec("kept", None, None)).await;
    for (request_id, session) in [(4, &running), (5, &ended), (6, &kept)] {
        attach(&mut client, request_id, &session.id).await;
    }
    stop(core);
    kill_matching(&format!("{}.sock", ended.id.0));
    for session in [&running, &ended] {
        mark_closing(&installed, &session.id);
    }

    let core = installed.start_core();
    let mut client = AppClient::greeted_with(&installed.core_socket(), 3).await;
    let started = Instant::now();
    loop {
        let names: Vec<Option<String>> = listed(&mut client)
            .await
            .into_iter()
            .map(|info| info.custom_name)
            .collect();
        if names == [Some("kept".to_owned())] {
            break;
        }
        assert!(started.elapsed() < Duration::from_secs(10), "{names:?}");
        client.pause(Duration::from_millis(100)).await;
    }
    for session in [&running, &ended] {
        let folder = installed.root.join("sessions").join(&session.id.0);
        let started = Instant::now();
        while folder.exists() {
            assert!(started.elapsed() < Duration::from_secs(5), "{} was kept", session.id.0);
            client.pause(Duration::from_millis(50)).await;
        }
    }
    stop(core);
}

/// Marks a session's record closed, as a core that ended right after the user closed it leaves it.
fn mark_closing(installed: &Installed, session: &SessionId) {
    let file = installed.root.join("sessions").join(&session.0).join("meta.json");
    let text = std::fs::read_to_string(&file).unwrap();
    assert!(!text.contains("\"closing\""), "{text}");
    let marked = text.replacen('{', "{\"closing\":true,", 1);
    std::fs::write(&file, marked).unwrap();
}

#[tokio::test]
async fn restores_the_screen_below_a_full_screen_program_and_keeps_when_it_was_restored_across_a_core_restart() {
    let installed = Installed::new();
    let core = installed.start_core();
    let mut client = AppClient::greeted_with(&installed.core_socket(), 3).await;
    let session = create(&mut client, 1, spec("editor", None, None)).await;
    let stream = attach(&mut client, 2, &session.id).await;
    print_saved(&mut client, &installed, stream, &session.id, "TRC-PRIMARY").await;
    client.input(stream, "printf '\\033[?1049hTRC-ALT-%s' $((40+2)); sleep 1000\r");
    client.until(|c| c.text(stream).contains("TRC-ALT-42")).await;
    client.pause(Duration::from_secs(3)).await;
    kill_holders(&installed);
    let restored = until_updated(&mut client, |info| {
        info.state == SessionState::Running && info.restored.is_some()
    })
    .await;
    let stream = attach(&mut client, 3, &session.id).await;
    let text = client.text(stream);
    assert!(
        text.contains("TRC-PRIMARY-42") && !text.contains("TRC-ALT-42"),
        "{text}"
    );
    client.input(stream, "echo TRC-AFTER-$((40+2))\r");
    client.until(|c| c.text(stream).contains("TRC-AFTER-42")).await;
    stop(core);

    let core = installed.start_core();
    let mut client = AppClient::greeted_with(&installed.core_socket(), 3).await;
    let sessions = listed(&mut client).await;
    assert_eq!(sessions[0].restored, restored.restored);
    stop(core);
}

#[tokio::test]
async fn restores_a_session_that_saves_nothing_to_disk_in_a_new_shell_below_only_the_marker() {
    let installed = Installed::new();
    let core = installed.start_core();
    let mut client = AppClient::greeted_with(&installed.core_socket(), 3).await;
    let unsaved = SessionOptions {
        restore: true,
        save_scrollback: false,
        integration: None,
    };
    let session = create(&mut client, 1, spec("private", None, Some(unsaved))).await;
    let stream = attach(&mut client, 2, &session.id).await;
    client.input(stream, "echo TRC-UNSAVED-$((40+2))\r");
    client.until(|c| c.text(stream).contains("TRC-UNSAVED-42")).await;
    let folder = installed.root.join("sessions").join(&session.id.0);
    assert!(!folder.join("scrollback.log").exists());
    kill_holders(&installed);
    until_updated(&mut client, |info| {
        info.state == SessionState::Running && info.restored.is_some()
    })
    .await;
    let stream = attach(&mut client, 3, &session.id).await;
    let text = client.text(stream);
    assert!(
        text.contains("Session restored on ") && !text.contains("TRC-UNSAVED-42"),
        "{text}"
    );
    assert!(!folder.join("scrollback.log").exists());
    stop(core);
}
