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

/// A temporary install root: `<base>/r/versions/test/trcd`, plus a home directory for the account.
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

    /// A command running the installed binary with a minimal account environment.
    pub fn command(&self, args: &[&str]) -> Command {
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
    fn drop(&mut self) {
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

/// Stops a core started by a test.
pub fn stop(mut child: Child) {
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

    /// Connects and completes the handshake.
    pub async fn greeted(socket: &Path) -> Self {
        let mut client = Self::connect(socket).await;
        client.send(&ClientMessage::Hello {
            min_proto: 1,
            max_proto: 1,
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
