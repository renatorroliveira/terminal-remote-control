//! The core as a temporary LaunchAgent on this Mac (D-50, P-58, P-60): the bridge registers it where the user has a
//! GUI login, launchd restarts it after a crash, a changed plist replaces it, and no step ends a session (US-4.1.1,
//! US-4.3.2, US-4.3.3). Each agent runs a scratch install root, keeps its plist in the scratch home, and is booted out
//! when the test ends.
#![cfg(target_os = "macos")]

mod support;

use std::collections::BTreeMap;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use support::{AppClient, Installed};
use trc_protocol::{
    ClientMessage, CreateSessionSpec, ServerMessage, ServiceManager, SessionInfo, SessionState, TerminalSize,
};
use trcd::launchd::{agent_label, has_gui_session, plist_path, stop_agent};

/// How long launchd may take to start a core again: the agent's `ThrottleInterval` is 1 s, and a loaded Mac may lag.
const RESTART_WAIT: Duration = Duration::from_secs(25);

#[tokio::test]
async fn registers_the_core_as_a_launch_agent_that_keeps_every_session() {
    if no_gui_session() {
        return;
    }
    let installed = Installed::new();
    let root = std::fs::canonicalize(&installed.root).unwrap();
    run_bridge(&installed);
    let plist = plist_path(&installed.home, &agent_label(&root));
    let mode = std::fs::metadata(&plist).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o600);
    let first = core_pid(&installed, None, "registered").await;
    let (mut client, manager) = greeted(&installed).await;
    assert_eq!(manager, Some(ServiceManager::Launchd));
    let shell = create_session(&mut client).await;
    drop(client);

    kill(first);
    let second = core_pid(&installed, Some(first), "after the crash").await;
    assert_eq!(session(&installed).await.pid, Some(shell), "a crash ended the session");

    restart_daemon(&installed, second).await;
    run_bridge(&installed);
    let third = core_pid(&installed, Some(second), "kickstarted").await;
    assert_eq!(
        session(&installed).await.pid,
        Some(shell),
        "a restart ended the session"
    );

    restart_daemon(&installed, third).await;
    std::fs::write(
        &plist,
        std::fs::read_to_string(&plist)
            .unwrap()
            .replace("Interactive", "Standard"),
    )
    .unwrap();
    run_bridge(&installed);
    let fourth = core_pid(&installed, Some(third), "replaced").await;
    assert!(std::fs::read_to_string(&plist).unwrap().contains("Interactive"));
    assert_eq!(
        session(&installed).await.pid,
        Some(shell),
        "replacing the agent ended the session"
    );

    stop_agent(&root);
    wait_gone(fourth).await;
    assert!(alive(shell), "booting the agent out ended the session");
    run_bridge(&installed);
    core_pid(&installed, Some(fourth), "registered again").await;
    assert_eq!(session(&installed).await.pid, Some(shell));
}

#[tokio::test]
async fn an_upgrade_replaces_the_agent_s_core_and_keeps_every_session() {
    if no_gui_session() {
        return;
    }
    let installed = Installed::new();
    run_bridge(&installed);
    let old = core_pid(&installed, None, "registered").await;
    let (mut client, _) = greeted(&installed).await;
    let shell = create_session(&mut client).await;
    drop(client);
    let lock = installed.root.join("run/core.lock");
    let text = std::fs::read_to_string(&lock).unwrap();
    let older: Vec<&str> = text
        .lines()
        .enumerate()
        .map(|(index, line)| if index == 1 { "0.0.1" } else { line })
        .collect();
    std::fs::write(&lock, format!("{}\n", older.join("\n"))).unwrap();
    run_bridge(&installed);
    let new = core_pid(&installed, Some(old), "upgraded").await;
    let (_, manager) = greeted(&installed).await;
    assert_eq!(manager, Some(ServiceManager::Launchd), "{}", agent_state(&installed));
    assert!(!alive(old));
    assert!(alive(new));
    assert_eq!(
        session(&installed).await.pid,
        Some(shell),
        "the upgrade ended the session"
    );
}

/// Asks the core to restart, as Restart daemon does, which ends it with status 0, so launchd leaves it stopped until
/// a bridge starts the agent again (US-3.3.2).
async fn restart_daemon(installed: &Installed, core: u32) {
    let (client, _) = greeted(installed).await;
    client.send(&ClientMessage::RestartDaemon { request_id: 5 });
    wait_gone(core).await;
    tokio::time::sleep(Duration::from_secs(1)).await;
    assert!(
        !installed.core_socket().exists(),
        "launchd started the core again: {}",
        agent_state(installed)
    );
}

/// Runs a bridge with no input, which starts the core if none serves, relays nothing and exits once its reply time is
/// up.
fn run_bridge(installed: &Installed) {
    let output = installed.command_under_launchd(&["bridge"]).output().unwrap();
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
}

/// A client greeted in the newest protocol, and the service manager its Welcome names.
async fn greeted(installed: &Installed) -> (AppClient, Option<ServiceManager>) {
    let mut client = AppClient::connect(&installed.core_socket()).await;
    client.send(&ClientMessage::Hello {
        min_proto: 1,
        max_proto: trc_protocol::PROTOCOL_VERSION,
        app_version: "test".into(),
        caps: vec![],
    });
    let welcome = client
        .take(|message| matches!(message, ServerMessage::Welcome { .. }))
        .await;
    let manager = match welcome {
        ServerMessage::Welcome { service, .. } => service.map(|service| service.manager),
        _ => None,
    };
    (client, manager)
}

async fn create_session(client: &mut AppClient) -> u32 {
    client.send(&ClientMessage::Create {
        request_id: 1,
        spec: CreateSessionSpec {
            profile_id: None,
            cwd: None,
            name: Some("launchd".into()),
            env: BTreeMap::new(),
            size: TerminalSize { cols: 80, rows: 24 },
            scrollback_lines: None,
            options: None,
        },
    });
    client
        .take(|message| matches!(message, ServerMessage::Created { .. }))
        .await;
    drop(std::mem::take(&mut client.messages));
    let started = Instant::now();
    loop {
        if let Some(pid) = listed(client).await.first().and_then(|info| info.pid) {
            return pid;
        }
        assert!(started.elapsed() < support::WAIT, "the session never ran");
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

async fn session(installed: &Installed) -> SessionInfo {
    let started = Instant::now();
    loop {
        let mut client = AppClient::greeted(&installed.core_socket()).await;
        let sessions = listed(&mut client).await;
        if let Some(info) = sessions.into_iter().find(|info| info.state == SessionState::Running) {
            return info;
        }
        assert!(
            started.elapsed() < support::WAIT,
            "the session is not listed as running"
        );
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

async fn listed(client: &mut AppClient) -> Vec<SessionInfo> {
    client.send(&ClientMessage::ListSessions { request_id: 9 });
    match client
        .take(|message| matches!(message, ServerMessage::Sessions { request_id: 9, .. }))
        .await
    {
        ServerMessage::Sessions { sessions, .. } => sessions,
        _ => Vec::new(),
    }
}

/// The running core's process ID, once it is one other than `old` and serves its socket.
async fn core_pid(installed: &Installed, old: Option<u32>, step: &str) -> u32 {
    let lock: PathBuf = installed.root.join("run/core.lock");
    let started = Instant::now();
    loop {
        let pid = std::fs::read_to_string(&lock)
            .ok()
            .and_then(|text| text.lines().next()?.trim().parse::<u32>().ok())
            .filter(|pid| Some(*pid) != old && alive(*pid));
        if let Some(pid) = pid
            && tokio::net::UnixStream::connect(installed.core_socket()).await.is_ok()
        {
            return pid;
        }
        assert!(
            started.elapsed() < RESTART_WAIT,
            "no new core {step}, after {old:?}: {pid:?}, {:?}: {}",
            tokio::net::UnixStream::connect(installed.core_socket()).await.err(),
            agent_state(installed)
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

fn kill(pid: u32) {
    let pid = rustix::process::Pid::from_raw(pid.cast_signed()).unwrap();
    rustix::process::kill_process(pid, rustix::process::Signal::KILL).unwrap();
}

fn alive(pid: u32) -> bool {
    rustix::process::Pid::from_raw(pid.cast_signed()).is_some_and(|pid| rustix::process::test_kill_process(pid).is_ok())
}

async fn wait_gone(pid: u32) {
    let started = Instant::now();
    while alive(pid) {
        assert!(started.elapsed() < support::WAIT, "the core did not end");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

/// What launchd and the agent's log say, for a failure's message.
fn agent_state(installed: &Installed) -> String {
    let root = std::fs::canonicalize(&installed.root).unwrap();
    let service = format!("gui/{}/{}", rustix::process::geteuid().as_raw(), agent_label(&root));
    let printed = std::process::Command::new("launchctl")
        .args(["print", &service])
        .output()
        .unwrap();
    let log = std::fs::read_to_string(root.join("logs/launchd.log")).unwrap_or_default();
    let lock = std::fs::read_to_string(root.join("run/core.lock")).unwrap_or_default();
    let socket = installed.core_socket().exists();
    let state: String = String::from_utf8_lossy(&printed.stdout)
        .lines()
        .filter(|line| {
            ["state =", "pid =", "runs =", "last exit"]
                .iter()
                .any(|key| line.contains(key))
        })
        .collect::<Vec<_>>()
        .join(" | ");
    format!("{state}\nlock: {lock:?}, socket: {socket}\nlog: {log}")
}

/// Whether the user has no GUI login session, which a LaunchAgent needs: the test then says it checked nothing, as
/// on a CI runner without one, rather than passing in silence.
fn no_gui_session() -> bool {
    let missing = !has_gui_session(rustix::process::geteuid().as_raw());
    if missing {
        eprintln!("skipped: no GUI login session, so launchd has no gui/<uid> domain for the agent");
    }
    missing
}
