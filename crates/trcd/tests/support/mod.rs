//! Helpers shared by the integration tests: a private install root holding a copy of `trcd`, processes started
//! from it, and a protocol client.

#![allow(dead_code, reason = "each test crate uses a different subset of the helpers")]

use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};

use tokio::net::UnixStream;
use tokio::net::unix::OwnedReadHalf;
use trc_protocol::frame::{self, Frame, FrameKind};
use trc_protocol::{ClientMessage, ServerMessage};
use trcd::frame_io::{FrameReader, FrameSender};

/// How long a test waits for anything.
pub const WAIT: Duration = Duration::from_secs(10);

static NEXT: AtomicU32 = AtomicU32::new(0);

/// A temporary install root: `<base>/r/versions/test/trcd`, plus a home directory for the account and `<base>/bin`,
/// whose `launchctl` always fails, so a bridge on a Mac with a GUI login starts its core detached unless a test
/// asks for launchd with [`Installed::command_under_launchd`].
pub struct Installed {
    /// The base directory, under `/tmp` so socket paths stay short.
    pub base: PathBuf,
    /// The install root.
    pub root: PathBuf,
    /// The installed binary.
    pub binary: PathBuf,
    /// The account's home directory.
    pub home: PathBuf,
}

impl Installed {
    /// Copies the built `trcd` into a new private install root.
    pub fn new() -> Self {
        let base = PathBuf::from(format!(
            "/tmp/trct-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&base);
        let version_dir = base.join("r/versions/test");
        std::fs::DirBuilder::new()
            .mode(0o700)
            .recursive(true)
            .create(&version_dir)
            .unwrap();
        for dir in ["", "r", "r/versions"] {
            std::fs::set_permissions(base.join(dir), std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        let binary = version_dir.join("trcd");
        copy_without_open_descriptors(Path::new(env!("CARGO_BIN_EXE_trcd")), &binary);
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700)).unwrap();
        let home = base.join("home");
        std::fs::DirBuilder::new().mode(0o700).create(&home).unwrap();
        std::fs::DirBuilder::new().mode(0o700).create(base.join("bin")).unwrap();
        let stub = base.join("bin/launchctl");
        std::fs::write(&stub, "#!/bin/sh\nexit 1\n").unwrap();
        std::fs::set_permissions(&stub, std::fs::Permissions::from_mode(0o700)).unwrap();
        Self {
            root: base.join("r"),
            base,
            binary,
            home,
        }
    }

    /// The core's socket.
    pub fn core_socket(&self) -> PathBuf {
        self.root.join("run/core.sock")
    }

    /// A command running the installed binary with a minimal account environment, where `launchctl` fails.
    pub fn command(&self, args: &[&str]) -> Command {
        let mut command = self.command_under_launchd(args);
        command.env(
            "PATH",
            format!("{}:/usr/local/bin:/usr/bin:/bin", self.base.join("bin").display()),
        );
        command
    }

    /// A command running the installed binary with a minimal account environment and the system's `launchctl`, so
    /// a bridge registers its core as a temporary LaunchAgent for this install (P-58), which `drop` boots out.
    pub fn command_under_launchd(&self, args: &[&str]) -> Command {
        let mut command = Command::new(&self.binary);
        command
            .args(args)
            .env_clear()
            .env("HOME", &self.home)
            .env("USER", "tester")
            .env("SHELL", "/bin/sh")
            .env("PATH", "/usr/local/bin:/usr/bin:/bin")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        command
    }

    /// Starts `trcd core` in the foreground and waits until it accepts connections.
    pub fn start_core(&self) -> Child {
        let child = self.command(&["core"]).spawn().unwrap();
        wait_for_server(&self.core_socket());
        child
    }
}

impl Drop for Installed {
    /// Boots out the install's LaunchAgent, if a test registered one, ends every process the install's binary still
    /// runs, as holders outlive their core by design, then removes it.
    fn drop(&mut self) {
        if cfg!(target_os = "macos")
            && let Ok(root) = std::fs::canonicalize(&self.root)
        {
            let service = format!(
                "gui/{}/{}",
                rustix::process::geteuid().as_raw(),
                trcd::launchd::agent_label(&root)
            );
            let _ = Command::new("launchctl")
                .args(["bootout", &service])
                .stderr(Stdio::null())
                .status();
        }
        if let Some(name) = self.base.file_name() {
            let pattern = format!("{}/r/versions/test/trcd", name.to_string_lossy());
            let _ = Command::new("pkill").args(["-KILL", "-f", &pattern]).status();
        }
        let _ = std::fs::remove_dir_all(&self.base);
    }
}

/// Copies a file in a child process, so no write descriptor to it ever exists in this process. Otherwise a
/// concurrent fork in another test thread inherits one and executing the copy fails with `ETXTBSY`.
pub fn copy_without_open_descriptors(from: &Path, to: &Path) {
    let status = Command::new("cp").arg(from).arg(to).status().unwrap();
    assert!(status.success(), "cp failed: {status}");
}

/// Waits until `path` exists.
pub fn wait_for(path: &Path) {
    let deadline = Instant::now() + WAIT;
    while !path.exists() {
        assert!(Instant::now() < deadline, "{} never appeared", path.display());
        std::thread::sleep(Duration::from_millis(10));
    }
}

/// Waits until a server accepts connections on the socket at `path`.
pub fn wait_for_server(path: &Path) {
    let deadline = Instant::now() + WAIT;
    while std::os::unix::net::UnixStream::connect(path).is_err() {
        assert!(Instant::now() < deadline, "nothing serves {}", path.display());
        std::thread::sleep(Duration::from_millis(10));
    }
}

/// Waits for a child to exit, killing it after [`WAIT`].
pub fn wait_child(child: &mut Child) -> std::process::ExitStatus {
    let deadline = Instant::now() + WAIT;
    loop {
        if let Some(status) = child.try_wait().unwrap() {
            return status;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            panic!("process did not exit");
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

/// Stops a core started by a test the way the service manager does, with SIGTERM, and kills it if it lingers.
pub fn stop(mut child: Child) {
    if let Some(pid) = rustix::process::Pid::from_raw(child.id().cast_signed()) {
        let _ = rustix::process::kill_process(pid, rustix::process::Signal::TERM);
    }
    let started = std::time::Instant::now();
    while started.elapsed() < Duration::from_secs(5) {
        if child.try_wait().is_ok_and(|status| status.is_some()) {
            return;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    let _ = child.kill();
    let _ = child.wait();
}

/// An app-side connection to the core.
pub struct AppClient {
    reader: FrameReader<OwnedReadHalf>,
    sender: FrameSender,
    /// Control messages received and not yet taken.
    pub messages: Vec<ServerMessage>,
    /// Output received, per stream.
    pub output: std::collections::BTreeMap<u32, Vec<u8>>,
    /// Whether the core closed the connection.
    pub closed: bool,
}

impl AppClient {
    /// Connects to a core socket.
    pub async fn connect(socket: &Path) -> Self {
        let (read, write) = UnixStream::connect(socket).await.unwrap().into_split();
        let (sender, _writer) = FrameSender::spawn(write);
        Self {
            reader: FrameReader::new(read),
            sender,
            messages: Vec::new(),
            output: std::collections::BTreeMap::new(),
            closed: false,
        }
    }

    /// Connects and completes the handshake as an E1 app, which speaks protocol 1 only.
    pub async fn greeted(socket: &Path) -> Self {
        Self::greeted_with(socket, 1).await
    }

    /// Connects and completes the handshake, speaking protocols 1 to `max_proto`.
    pub async fn greeted_with(socket: &Path, max_proto: u32) -> Self {
        let mut client = Self::connect(socket).await;
        client.send(&ClientMessage::Hello {
            min_proto: 1,
            max_proto,
            app_version: "test".into(),
            caps: vec![],
        });
        client
            .take(|message| matches!(message, ServerMessage::Welcome { .. }))
            .await;
        client
    }

    /// Sends a control message.
    pub fn send(&self, message: &ClientMessage) {
        let payload = serde_json::to_vec(message).unwrap();
        assert!(
            self.sender
                .send(frame::encode(FrameKind::Control, 0, &payload).unwrap())
        );
    }

    /// Sends input on a stream.
    pub fn input(&self, stream: u32, text: &str) {
        assert!(
            self.sender
                .send(frame::encode(FrameKind::Input, stream, text.as_bytes()).unwrap())
        );
    }

    /// Grants output credit on a stream.
    pub fn credit(&self, stream: u32, bytes: u32) {
        assert!(self.sender.send(frame::encode_credit(stream, bytes)));
    }

    /// Reads frames until a received control message matches, then removes and returns it.
    pub async fn take(&mut self, wanted: impl Fn(&ServerMessage) -> bool) -> ServerMessage {
        loop {
            if let Some(index) = self.messages.iter().position(&wanted) {
                return self.messages.remove(index);
            }
            self.step().await;
            assert!(!self.closed, "the core closed the connection; got {:?}", self.messages);
        }
    }

    /// Reads frames until `done` holds.
    pub async fn until(&mut self, done: impl Fn(&Self) -> bool) {
        while !done(self) {
            self.step().await;
            assert!(!self.closed, "the core closed the connection");
        }
    }

    /// Reads frames until nothing arrives for half a second, so a shell's line editor is ready for typing.
    pub async fn settle(&mut self) {
        while let Ok(next) = tokio::time::timeout(std::time::Duration::from_millis(500), self.reader.next()).await {
            match next {
                Ok(Some(frame)) => self.absorb(frame),
                _ => {
                    self.closed = true;
                    return;
                }
            }
        }
    }

    /// Reads frames for `duration`, so output keeps arriving while a test waits.
    pub async fn pause(&mut self, duration: std::time::Duration) {
        let until = tokio::time::Instant::now() + duration;
        while let Ok(next) = tokio::time::timeout_at(until, self.reader.next()).await {
            match next {
                Ok(Some(frame)) => self.absorb(frame),
                _ => {
                    self.closed = true;
                    return;
                }
            }
        }
    }

    /// Reads frames until the core closes the connection.
    pub async fn until_closed(&mut self) {
        while !self.closed {
            self.step().await;
        }
    }

    /// The output received on a stream, as text.
    pub fn text(&self, stream: u32) -> String {
        String::from_utf8_lossy(self.output.get(&stream).map_or(&[][..], Vec::as_slice)).into_owned()
    }

    async fn step(&mut self) {
        let Ok(next) = tokio::time::timeout(WAIT, self.reader.next()).await else {
            let tails: Vec<String> = self.output.keys().map(|stream| self.text(*stream)).collect();
            panic!(
                "the core went quiet; unread messages: {:?}; output: {tails:?}",
                self.messages
            );
        };
        match next {
            Ok(Some(frame)) => self.absorb(frame),
            _ => self.closed = true,
        }
    }

    fn absorb(&mut self, frame: Frame) {
        match frame.kind {
            FrameKind::Control => self.messages.push(serde_json::from_slice(&frame.payload).unwrap()),
            FrameKind::Output => self.output.entry(frame.stream).or_default().extend(frame.payload),
            other => panic!("unexpected frame {other:?}"),
        }
    }
}

/// Kills with SIGKILL every process whose command line contains `pattern`, with `pkill` or, where it is missing (the
/// test containers), by reading `/proc`.
pub fn kill_matching(pattern: &str) {
    let ran = std::process::Command::new("pkill")
        .args(["-KILL", "-f", pattern])
        .status();
    if ran.is_ok() {
        return;
    }
    for pid in proc_matching(pattern) {
        let _ = rustix::process::kill_process(pid, rustix::process::Signal::KILL);
    }
}

/// Whether a process whose command line contains `pattern` runs, from `pgrep` or, where it is missing, `/proc`.
pub fn any_matching(pattern: &str) -> bool {
    match std::process::Command::new("pgrep").args(["-f", pattern]).output() {
        Ok(output) => !output.stdout.is_empty(),
        Err(_) => !proc_matching(pattern).is_empty(),
    }
}

/// The processes whose command line, read from `/proc`, contains `pattern`.
fn proc_matching(pattern: &str) -> Vec<rustix::process::Pid> {
    let Ok(entries) = std::fs::read_dir("/proc") else {
        return Vec::new();
    };
    entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let pid = entry.file_name().to_str()?.parse::<i32>().ok()?;
            let command = std::fs::read(entry.path().join("cmdline")).unwrap_or_default();
            let command = String::from_utf8_lossy(&command).replace('\0', " ");
            command
                .contains(pattern)
                .then(|| rustix::process::Pid::from_raw(pid))
                .flatten()
        })
        .collect()
}

/// The parent process of `pid`, from `ps` or, where `ps` is missing, `/proc`.
pub fn parent_of(pid: i32) -> i32 {
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
