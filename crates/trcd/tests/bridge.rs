//! `trcd bridge` as the app runs it over the SSH exec channel: it starts a detached core when none runs and relays
//! frames between stdio and the core (US-1.5.1, US-1.5.3, P-17).

mod support;

use std::io::{Read, Write};
use std::process::{Child, ChildStdin, ChildStdout, Stdio};

use support::{Installed, wait_child, wait_for};
use trc_protocol::frame::{self, FrameDecoder, FrameKind};
use trc_protocol::{ClientMessage, ServerMessage, SessionChange, TerminalSize};

struct Bridge {
    child: Child,
    stdin: Option<ChildStdin>,
    stdout: ChildStdout,
    decoder: FrameDecoder,
}

impl Bridge {
    fn start(installed: &Installed) -> Self {
        let mut child = installed
            .command(&["bridge"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let stdin = child.stdin.take();
        let stdout = child.stdout.take().unwrap();
        Self {
            child,
            stdin,
            stdout,
            decoder: FrameDecoder::new(),
        }
    }

    fn send(&mut self, message: &ClientMessage) {
        let payload = serde_json::to_vec(message).unwrap();
        let encoded = frame::encode(FrameKind::Control, 0, &payload).unwrap();
        self.stdin.as_mut().unwrap().write_all(&encoded).unwrap();
    }

    fn receive(&mut self, wanted: impl Fn(&ServerMessage) -> bool) -> ServerMessage {
        let mut buffer = [0_u8; 4096];
        loop {
            while let Some(frame) = self.decoder.next_frame().unwrap() {
                if frame.kind == FrameKind::Control {
                    let message: ServerMessage = serde_json::from_slice(&frame.payload).unwrap();
                    if wanted(&message) {
                        return message;
                    }
                }
            }
            let read = self.stdout.read(&mut buffer).unwrap();
            assert!(read > 0, "the bridge closed its output");
            self.decoder.push(&buffer[..read]);
        }
    }

    fn hello(&mut self) {
        self.send(&ClientMessage::Hello {
            min_proto: 1,
            max_proto: 1,
            app_version: "test".into(),
            caps: vec![],
        });
        self.receive(|m| matches!(m, ServerMessage::Welcome { .. }));
    }

    fn finish(mut self) -> std::process::ExitStatus {
        drop(self.stdin.take());
        wait_child(&mut self.child)
    }
}

fn core_pid(installed: &Installed) -> i32 {
    let lock = installed.root.join("run/core.lock");
    wait_for(&lock);
    let deadline = std::time::Instant::now() + support::WAIT;
    loop {
        if let Ok(pid) = std::fs::read_to_string(&lock).unwrap_or_default().trim().parse() {
            return pid;
        }
        assert!(std::time::Instant::now() < deadline, "the core never wrote its pid");
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
}

fn parent_of(pid: i32) -> i32 {
    let output = std::process::Command::new("ps")
        .args(["-o", "ppid=", "-p", &pid.to_string()])
        .output();
    if let Some(output) = output.ok().filter(|output| output.status.success()) {
        return String::from_utf8_lossy(&output.stdout).trim().parse().unwrap();
    }
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).unwrap();
    let after_name = &stat[stat.rfind(')').unwrap() + 2..];
    after_name.split(' ').nth(1).unwrap().parse().unwrap()
}

fn kill(pid: i32) {
    let _ = rustix::process::kill_process(
        rustix::process::Pid::from_raw(pid).unwrap(),
        rustix::process::Signal::KILL,
    );
}

#[test]
fn starts_a_detached_core_that_outlives_the_bridge() {
    let installed = Installed::new();
    let mut first = Bridge::start(&installed);
    first.hello();
    let bridge_pid = i32::try_from(first.child.id()).unwrap();
    let core = core_pid(&installed);
    assert_ne!(parent_of(core), bridge_pid);
    first.send(&ClientMessage::Create {
        request_id: 1,
        spec: trc_protocol::CreateSessionSpec {
            profile_id: None,
            cwd: None,
            name: Some("kept".into()),
            env: Default::default(),
            size: TerminalSize { cols: 80, rows: 24 },
            scrollback_lines: None,
        },
    });
    first.receive(|m| matches!(m, ServerMessage::Created { .. }));
    assert!(first.finish().success());

    let mut second = Bridge::start(&installed);
    second.hello();
    second.send(&ClientMessage::ListSessions { request_id: 2 });
    let ServerMessage::Sessions { sessions, .. } = second.receive(|m| matches!(m, ServerMessage::Sessions { .. }))
    else {
        unreachable!()
    };
    assert_eq!(
        sessions.iter().map(|s| s.custom_name.as_deref()).collect::<Vec<_>>(),
        vec![Some("kept")]
    );
    assert_eq!(core_pid(&installed), core);
    assert!(second.finish().success());
    kill(core);
}

#[test]
fn two_bridges_starting_at_once_share_one_core() {
    let installed = Installed::new();
    let mut bridges: Vec<Bridge> = (0..3).map(|_| Bridge::start(&installed)).collect();
    for bridge in &mut bridges {
        bridge.hello();
    }
    bridges[0].send(&ClientMessage::Create {
        request_id: 1,
        spec: trc_protocol::CreateSessionSpec {
            profile_id: None,
            cwd: None,
            name: None,
            env: Default::default(),
            size: TerminalSize { cols: 80, rows: 24 },
            scrollback_lines: None,
        },
    });
    for bridge in &mut bridges[1..] {
        bridge.receive(|m| {
            matches!(
                m,
                ServerMessage::SessionEvent {
                    change: SessionChange::Created { .. }
                }
            )
        });
    }
    let core = core_pid(&installed);
    for bridge in bridges {
        assert!(bridge.finish().success());
    }
    kill(core);
}

#[test]
fn delivers_the_reply_to_a_request_sent_just_before_its_input_closes() {
    let installed = Installed::new();
    let mut warm = Bridge::start(&installed);
    warm.hello();
    assert!(warm.finish().success());
    for _ in 0..20 {
        let mut bridge = Bridge::start(&installed);
        bridge.send(&ClientMessage::Hello {
            min_proto: 1,
            max_proto: 1,
            app_version: "test".into(),
            caps: vec![],
        });
        drop(bridge.stdin.take());
        bridge.receive(|m| matches!(m, ServerMessage::Welcome { .. }));
        assert!(bridge.finish().success());
    }
    kill(core_pid(&installed));
}

#[test]
fn prints_the_version_and_the_binary_checksum() {
    let installed = Installed::new();
    let output = installed
        .command(&["--version"])
        .stdout(Stdio::piped())
        .output()
        .unwrap();
    let sha = trcd::digest::sha256_file(&installed.binary).unwrap();
    assert_eq!(
        String::from_utf8_lossy(&output.stdout),
        format!("trcd {} {sha}\n", env!("CARGO_PKG_VERSION"))
    );
}
