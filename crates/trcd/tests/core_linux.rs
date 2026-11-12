//! Linux-only checks of a running daemon: no network sockets (SEC-01, US-1.5.1), memory within NFR-09, and peers
//! of another user refused (SEC-02).

#![cfg(target_os = "linux")]

mod support;

use std::collections::BTreeSet;
use std::os::unix::process::CommandExt;

use support::{AppClient, Installed, stop};
use trc_protocol::{ClientMessage, CreateSessionSpec, ServerMessage, SessionChange, SessionState, TerminalSize};

fn trcd_pids(installed: &Installed) -> Vec<u32> {
    let binary = std::fs::canonicalize(&installed.binary).unwrap();
    std::fs::read_dir("/proc")
        .unwrap()
        .filter_map(|entry| entry.ok()?.file_name().to_str()?.parse::<u32>().ok())
        .filter(|pid| std::fs::read_link(format!("/proc/{pid}/exe")).is_ok_and(|exe| exe == binary))
        .collect()
}

fn socket_inodes(pid: u32) -> BTreeSet<String> {
    std::fs::read_dir(format!("/proc/{pid}/fd"))
        .map(|entries| {
            entries
                .filter_map(|entry| std::fs::read_link(entry.ok()?.path()).ok())
                .filter_map(|target| {
                    let text = target.to_string_lossy().into_owned();
                    Some(text.strip_prefix("socket:[")?.strip_suffix(']')?.to_owned())
                })
                .collect()
        })
        .unwrap_or_default()
}

fn network_inodes() -> BTreeSet<String> {
    ["tcp", "tcp6", "udp", "udp6", "raw", "raw6"]
        .iter()
        .filter_map(|table| std::fs::read_to_string(format!("/proc/net/{table}")).ok())
        .flat_map(|text| {
            text.lines()
                .skip(1)
                .filter_map(|line| line.split_whitespace().nth(9).map(str::to_owned))
                .collect::<Vec<_>>()
        })
        .collect()
}

fn pss_kib(pid: u32) -> u64 {
    let rollup = std::fs::read_to_string(format!("/proc/{pid}/smaps_rollup")).unwrap();
    let line = rollup.lines().find(|line| line.starts_with("Pss:")).unwrap();
    line.split_whitespace().nth(1).unwrap().parse().unwrap()
}

async fn running_sessions(client: &mut AppClient, count: u32) {
    for request_id in 0..count {
        client.send(&ClientMessage::Create {
            request_id,
            spec: CreateSessionSpec {
                profile_id: None,
                cwd: None,
                name: None,
                env: Default::default(),
                size: TerminalSize { cols: 120, rows: 40 },
                scrollback_lines: None,
            },
        });
    }
    let mut running = 0;
    while running < count {
        client
            .take(|m| {
                matches!(m, ServerMessage::SessionEvent { change: SessionChange::Updated { session } }
                    if session.state == SessionState::Running)
            })
            .await;
        running += 1;
    }
}

#[tokio::test]
async fn no_daemon_process_has_a_network_socket() {
    let installed = Installed::new();
    let core = installed.start_core();
    let mut client = AppClient::greeted(&installed.core_socket()).await;
    running_sessions(&mut client, 2).await;
    let pids = trcd_pids(&installed);
    assert!(pids.len() >= 3, "core and two holders, found {pids:?}");
    let network = network_inodes();
    for pid in pids {
        let sockets = socket_inodes(pid);
        assert!(!sockets.is_empty() || pid != core.id());
        assert!(sockets.is_disjoint(&network), "process {pid} has a network socket");
    }
    stop(core);
}

#[tokio::test]
async fn stays_within_the_memory_budget() {
    let installed = Installed::new();
    let core = installed.start_core();
    let mut client = AppClient::greeted(&installed.core_socket()).await;
    running_sessions(&mut client, 3).await;
    let core_pid = core.id();
    for pid in trcd_pids(&installed) {
        let pss = pss_kib(pid);
        let budget = if pid == core_pid { 30 * 1024 } else { 10 * 1024 };
        assert!(pss <= budget, "process {pid} uses {pss} KiB of PSS, over {budget} KiB");
    }
    stop(core);
}

#[tokio::test]
async fn refuses_a_peer_of_another_user() {
    if !rustix::process::geteuid().is_root() {
        return;
    }
    let installed = Installed::new();
    let owner = 4242;
    chown_tree(&installed.base, owner);
    let mut command = installed.command(&["core"]);
    command.uid(owner).gid(owner);
    let core = command.spawn().unwrap();
    support::wait_for_server(&installed.core_socket());
    let mut client = AppClient::connect(&installed.core_socket()).await;
    client.send(&ClientMessage::Hello {
        min_proto: 1,
        max_proto: 1,
        app_version: "root".into(),
        caps: vec![],
    });
    client.until_closed().await;
    assert!(client.messages.is_empty(), "{:?}", client.messages);
    stop(core);
}

fn chown_tree(path: &std::path::Path, owner: u32) {
    let id = Some(rustix::process::Uid::from_raw(owner));
    let group = Some(rustix::process::Gid::from_raw(owner));
    rustix::fs::chown(path, id, group).unwrap();
    if path.is_dir() {
        for entry in std::fs::read_dir(path).unwrap() {
            chown_tree(&entry.unwrap().path(), owner);
        }
    }
}
