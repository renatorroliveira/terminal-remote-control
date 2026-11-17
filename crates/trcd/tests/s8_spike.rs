//! Spike S8 (E4 plan ST-52), throwaway (P-06): a core run as a temporary per-user LaunchAgent (P-58) keeps every
//! holder across `kickstart -k`, a SIGKILL that `KeepAlive` answers, and `bootout` then `bootstrap`. Runs only on macOS
//! with `TRC_SPIKE_S8=1`; the agent's plist lives in the scratch install, never in `~/Library/LaunchAgents`.
#![cfg(target_os = "macos")]

mod support;

use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;
use std::time::{Duration, Instant};

use support::{AppClient, Installed};
use trc_protocol::{ClientMessage, CreateSessionSpec, ServerMessage, SessionInfo, SessionState, TerminalSize};

fn uid() -> u32 {
    rustix::process::getuid().as_raw()
}

fn launchctl(args: &[&str]) -> (bool, String) {
    let out = Command::new("launchctl").args(args).output().unwrap();
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    (out.status.success(), text)
}

fn plist(installed: &Installed, label: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>{label}</string>
<key>ProgramArguments</key><array><string>{binary}</string><string>core</string></array>
<key>EnvironmentVariables</key><dict>
<key>HOME</key><string>{home}</string><key>USER</key><string>tester</string>
<key>SHELL</key><string>/bin/sh</string><key>PATH</key><string>/usr/bin:/bin</string></dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>AbandonProcessGroup</key><true/>
<key>StandardErrorPath</key><string>{err}</string>
</dict></plist>
"#,
        binary = installed.binary.display(),
        home = installed.home.display(),
        err = installed.base.join("agent.err").display(),
    )
}

fn core_pid(installed: &Installed) -> Option<i32> {
    let lock = std::fs::read_to_string(installed.root.join("run/core.lock")).ok()?;
    lock.lines().next()?.trim().parse().ok()
}

fn alive(pid: u32) -> bool {
    rustix::process::test_kill_process(rustix::process::Pid::from_raw(pid.cast_signed()).unwrap()).is_ok()
}

async fn wait_new_core(installed: &Installed, old: Option<i32>) -> i32 {
    let started = Instant::now();
    loop {
        if let Some(pid) = core_pid(installed).filter(|pid| Some(*pid) != old)
            && installed.core_socket().exists()
            && alive(pid.cast_unsigned())
        {
            return pid;
        }
        assert!(started.elapsed() < Duration::from_secs(20), "no new core");
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

async fn listed(installed: &Installed) -> Vec<SessionInfo> {
    let started = Instant::now();
    loop {
        let mut client = AppClient::greeted_with(&installed.core_socket(), 3).await;
        client.send(&ClientMessage::ListSessions { request_id: 9 });
        if let ServerMessage::Sessions { sessions, .. } = client
            .take(|m| matches!(m, ServerMessage::Sessions { request_id: 9, .. }))
            .await
            && !sessions.is_empty()
            && sessions.iter().all(|s| s.state == SessionState::Running)
        {
            return sessions;
        }
        assert!(
            started.elapsed() < Duration::from_secs(20),
            "the session is not listed as running"
        );
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

#[tokio::test]
async fn s8_launchd_agent_keeps_every_holder() {
    if std::env::var("TRC_SPIKE_S8").is_err() {
        return;
    }
    let installed = Installed::new();
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let label = format!("dev.trc.test-{:x}", nanos & 0xffff_ffff);
    let file = installed.base.join(format!("{label}.plist"));
    std::fs::write(&file, plist(&installed, &label)).unwrap();
    let domain = format!("gui/{}", uid());
    let service = format!("{domain}/{label}");
    let report = |step: &str, text: &str| eprintln!("S8 {step}: {}", text.trim());

    let (ok, text) = launchctl(&["bootstrap", &domain, &file.to_string_lossy()]);
    report("bootstrap", &format!("{ok} {text}"));
    assert!(ok);
    let first = wait_new_core(&installed, None).await;
    let mut client = AppClient::greeted_with(&installed.core_socket(), 3).await;
    client.send(&ClientMessage::Create {
        request_id: 1,
        spec: CreateSessionSpec {
            profile_id: None,
            cwd: None,
            name: Some("s8".into()),
            env: BTreeMap::new(),
            size: TerminalSize { cols: 80, rows: 24 },
            scrollback_lines: None,
            options: None,
        },
    });
    client.take(|m| matches!(m, ServerMessage::Created { .. })).await;
    let shell = listed(&installed).await[0].pid.unwrap();
    report("session", &format!("core {first}, shell {shell}"));
    drop(client);

    let (ok, text) = launchctl(&["kickstart", "-k", &service]);
    report("kickstart -k", &format!("{ok} {text}"));
    let second = wait_new_core(&installed, Some(first)).await;
    let after = listed(&installed).await;
    report(
        "after kickstart",
        &format!("core {second}, shell {:?}, alive {}", after[0].pid, alive(shell)),
    );
    assert_eq!(after[0].pid, Some(shell));

    rustix::process::kill_process(
        rustix::process::Pid::from_raw(second).unwrap(),
        rustix::process::Signal::KILL,
    )
    .unwrap();
    let third = wait_new_core(&installed, Some(second)).await;
    let after = listed(&installed).await;
    report("after SIGKILL", &format!("core {third}, shell {:?}", after[0].pid));
    assert_eq!(after[0].pid, Some(shell));

    let (ok, text) = launchctl(&["bootout", &service]);
    report("bootout", &format!("{ok} {text}"));
    tokio::time::sleep(Duration::from_secs(1)).await;
    report(
        "after bootout",
        &format!(
            "core alive {}, shell alive {}",
            alive(third.cast_unsigned()),
            alive(shell)
        ),
    );
    assert!(alive(shell), "bootout ended the session");

    let (ok, text) = launchctl(&["bootstrap", &domain, &file.to_string_lossy()]);
    report("bootstrap again", &format!("{ok} {text}"));
    let fourth = wait_new_core(&installed, Some(third)).await;
    let after = listed(&installed).await;
    report(
        "after bootstrap again",
        &format!("core {fourth}, shell {:?}", after[0].pid),
    );
    assert_eq!(after[0].pid, Some(shell));

    let (ok, text) = launchctl(&["print", &service]);
    report(
        "print",
        &format!(
            "{ok} {}",
            text.lines()
                .filter(|l| l.contains("state") || l.contains("runs") || l.contains("last exit"))
                .collect::<Vec<_>>()
                .join(" | ")
        ),
    );
    launchctl(&["bootout", &service]);
    let _ = Path::new(&file);
}
