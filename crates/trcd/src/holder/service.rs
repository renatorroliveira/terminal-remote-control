//! The holder's event loop: one session's PTY, emulator and output, served to whichever core is connected.
//!
//! The session keeps running while no core is connected: output still feeds the emulator, so the next core gets an
//! up-to-date snapshot.

use std::io;
use std::time::Duration;

use tokio::net::unix::OwnedReadHalf;
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;
use tokio::time::{Instant, Interval, MissedTickBehavior, interval, sleep_until};
use trc_protocol::frame::{self, Frame, FrameKind};
use trc_protocol::{ExitStatus, SessionState, TerminalSize};
use trc_vt::{GhosttyTerminal, Rgb, TerminalConfig, TerminalEvent, TerminalState};

use super::environment::{Account, session_environment};
use super::osc7::path_from_file_url;
use super::output_gate::OutputGate;
use super::protocol::{HolderCommand, HolderEvent, HolderSpec, HolderStatus, SESSION_STREAM};
use super::pty::{Pty, SpawnSpec};
use super::stop_plan::{DEFAULT_GRACE, StopSignal, stop_plan};
use crate::accept_backoff::AcceptBackoff;
use crate::frame_io::{FrameReader, FrameSender};
use crate::peer::is_same_user;
use crate::time::{format_utc, now_millis};

/// How often throttled status changes, such as the last-output time, are reported.
const STATUS_INTERVAL: Duration = Duration::from_secs(1);
/// The default foreground and background reported to OSC 10 and 11 queries.
const DEFAULT_COLORS: (Rgb, Rgb) = (Rgb(0xd4, 0xd4, 0xd4), Rgb(0x1e, 0x1e, 0x1e));

/// One session's holder.
pub struct Holder {
    spec: Option<HolderSpec>,
    name: Option<String>,
    terminal: Option<GhosttyTerminal>,
    pty: Option<Pty>,
    output: Option<mpsc::Receiver<Vec<u8>>>,
    exit: Option<oneshot::Receiver<ExitStatus>>,
    reader: Option<FrameReader<OwnedReadHalf>>,
    sender: Option<FrameSender>,
    writer: Option<JoinHandle<()>>,
    gate: OutputGate,
    status: HolderStatus,
    stopping: Option<Stopping>,
    after_exit: AfterExit,
    status_dirty: bool,
    finished: bool,
    accepting: AcceptBackoff,
}

struct Stopping {
    started: Instant,
    plan: [(Duration, StopSignal); 3],
    next: usize,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum AfterExit {
    Report,
    Restart,
    Shutdown,
}

impl Default for Holder {
    fn default() -> Self {
        Self::new()
    }
}

impl Holder {
    /// Creates a holder that has not started its session yet.
    pub fn new() -> Self {
        Self {
            spec: None,
            name: None,
            terminal: None,
            pty: None,
            output: None,
            exit: None,
            reader: None,
            sender: None,
            writer: None,
            gate: OutputGate::default(),
            status: HolderStatus {
                state: SessionState::Starting,
                pid: None,
                started_at: None,
                last_output_at: None,
                exit: None,
                failure: None,
                title: None,
                cwd: None,
                size: TerminalSize { cols: 80, rows: 24 },
            },
            stopping: None,
            after_exit: AfterExit::Report,
            status_dirty: false,
            finished: false,
            accepting: AcceptBackoff::default(),
        }
    }

    /// Serves cores connecting on `listener` until the session is shut down.
    pub async fn run(mut self, listener: UnixListener) {
        let mut status_tick = interval(STATUS_INTERVAL);
        status_tick.set_missed_tick_behavior(MissedTickBehavior::Delay);
        while !self.finished {
            self.step(&listener, &mut status_tick).await;
            self.flush_output();
        }
        self.sender = None;
        if let Some(writer) = self.writer.take() {
            let _ = writer.await;
        }
    }

    async fn step(&mut self, listener: &UnixListener, status_tick: &mut Interval) {
        let wants_output = self.gate.wants_output();
        tokio::select! {
            biased;
            frame = next_frame(&mut self.reader) => self.on_frame(frame),
            accepted = listener.accept(), if self.accepting.ready() => {
                self.on_accept(accepted.map(|(stream, _)| stream));
            }
            () = self.accepting.rested() => self.accepting.resume(),
            status = wait_exit(&mut self.exit) => self.on_exit(status),
            () = stop_deadline(&self.stopping) => self.escalate(),
            chunk = next_chunk(&mut self.output), if wants_output => self.on_output(chunk),
            _ = status_tick.tick() => self.flush_status(),
        }
    }

    fn on_accept(&mut self, accepted: io::Result<UnixStream>) {
        match accepted {
            Ok(stream) if is_same_user(&stream) => self.connect(stream),
            Ok(_) => {}
            Err(_) => self.accepting.failed(),
        }
    }

    fn connect(&mut self, stream: UnixStream) {
        let (read, write) = stream.into_split();
        self.gate.detach();
        let (sender, writer) = FrameSender::spawn(write);
        self.reader = Some(FrameReader::new(read));
        self.sender = Some(sender);
        self.writer = Some(writer);
        self.send_event(&HolderEvent::Hello {
            spec: self.spec.clone().map(Box::new),
            name: self.name.clone(),
        });
        self.send_status();
    }

    fn disconnect(&mut self) {
        self.reader = None;
        self.sender = None;
        self.gate.detach();
    }

    fn on_frame(&mut self, frame: io::Result<Option<Frame>>) {
        let Ok(Some(frame)) = frame else {
            self.disconnect();
            return;
        };
        match frame.kind {
            FrameKind::Control => self.on_control(&frame.payload),
            FrameKind::Input => self.on_input(frame.payload),
            FrameKind::Credit => self.on_credit(&frame.payload),
            _ => {}
        }
    }

    fn on_control(&mut self, payload: &[u8]) {
        let Ok(command) = serde_json::from_slice::<HolderCommand>(payload) else {
            return;
        };
        match command {
            HolderCommand::Start { spec } => self.start(*spec),
            HolderCommand::Attach { credit } => self.attach(credit),
            HolderCommand::Detach => self.gate.detach(),
            HolderCommand::Resize { size } => self.resize(size),
            HolderCommand::Stop { grace_ms } => self.stop(grace_ms, AfterExit::Report),
            HolderCommand::Restart => self.restart(),
            HolderCommand::Shutdown => self.shutdown(),
            HolderCommand::Name { name } => self.name = name,
        }
    }

    fn on_input(&mut self, bytes: Vec<u8>) {
        if let Some(pty) = &self.pty {
            pty.write(bytes);
        }
    }

    fn on_credit(&mut self, payload: &[u8]) {
        if let Some(bytes) = payload.first_chunk::<4>() {
            self.gate.grant(u32::from_be_bytes(*bytes));
        }
    }

    fn start(&mut self, spec: HolderSpec) {
        if self.spec.is_some() {
            return;
        }
        self.status.size = spec.size;
        let config = TerminalConfig {
            size: trc_vt::TerminalSize {
                cols: spec.size.cols,
                rows: spec.size.rows,
            },
            scrollback_lines: spec.scrollback_lines as usize,
            xtversion: format!("trcd {}", env!("CARGO_PKG_VERSION")),
            foreground: DEFAULT_COLORS.0,
            background: DEFAULT_COLORS.1,
        };
        match GhosttyTerminal::new(&config) {
            Ok(terminal) => self.terminal = Some(terminal),
            Err(error) => return self.fail(format!("terminal emulator: {error}")),
        }
        self.spec = Some(spec);
        self.spawn();
    }

    fn spawn(&mut self) {
        let Some(spec) = &self.spec else {
            return;
        };
        match Pty::spawn(&spawn_spec(spec, self.status.size)) {
            Ok((pty, output)) => {
                self.status.state = SessionState::Running;
                self.status.pid = Some(pty.pid());
                self.status.started_at = Some(now_millis());
                self.status.exit = None;
                self.status.failure = None;
                self.pty = Some(pty);
                self.output = Some(output.chunks);
                self.exit = Some(output.exit);
            }
            Err(error) => self.fail(error.to_string()),
        }
        self.send_status();
    }

    fn fail(&mut self, reason: String) {
        self.status.state = SessionState::FailedToStart;
        self.status.failure = Some(reason);
        self.status.pid = None;
        self.send_status();
    }

    fn attach(&mut self, credit: u32) {
        let snapshot = self
            .terminal
            .as_ref()
            .and_then(|terminal| terminal.snapshot().ok())
            .unwrap_or_default();
        self.gate.attach(credit, snapshot);
    }

    /// Resizes the emulator first and the PTY only once it has, so a resize the emulator refuses leaves both, and
    /// the size reported, as they were (US-1.11.3).
    fn resize(&mut self, size: TerminalSize) {
        if size.cols == 0 || size.rows == 0 {
            return;
        }
        let resized = self.terminal.as_mut().is_none_or(|terminal| {
            terminal
                .resize(trc_vt::TerminalSize {
                    cols: size.cols,
                    rows: size.rows,
                })
                .is_ok()
        });
        if !resized {
            return;
        }
        if let Some(pty) = &self.pty {
            let _ = pty.resize(size);
        }
        self.status.size = size;
        self.send_status();
    }

    fn stop(&mut self, grace_ms: Option<u32>, after: AfterExit) {
        if self.pty.is_none() || self.exit.is_none() {
            return self.after_stopped(after);
        }
        self.after_exit = after;
        if self.stopping.is_none() {
            let grace = grace_ms.map_or(DEFAULT_GRACE, |ms| Duration::from_millis(u64::from(ms)));
            self.stopping = Some(Stopping {
                started: Instant::now(),
                plan: stop_plan(grace),
                next: 0,
            });
            self.escalate();
        }
    }

    fn restart(&mut self) {
        self.stop(None, AfterExit::Restart);
    }

    fn shutdown(&mut self) {
        self.stop(None, AfterExit::Shutdown);
    }

    fn escalate(&mut self) {
        let Some(stopping) = &mut self.stopping else {
            return;
        };
        while let Some((delay, signal)) = stopping.plan.get(stopping.next).copied() {
            if stopping.started.elapsed() < delay {
                break;
            }
            stopping.next += 1;
            if let Some(pty) = &self.pty {
                pty.signal(signal);
            }
        }
    }

    fn on_exit(&mut self, status: ExitStatus) {
        let stopped = self.stopping.take().is_some();
        self.exit = None;
        self.pty = None;
        self.status.state = if stopped {
            SessionState::Stopped
        } else {
            SessionState::Exited
        };
        self.status.exit = Some(status);
        self.status.pid = None;
        self.send_status();
        let after = std::mem::replace(&mut self.after_exit, AfterExit::Report);
        self.after_stopped(after);
    }

    fn after_stopped(&mut self, after: AfterExit) {
        match after {
            AfterExit::Report => {}
            AfterExit::Restart => self.respawn_with_marker(),
            AfterExit::Shutdown => {
                self.send_event(&HolderEvent::Exiting);
                self.finished = true;
            }
        }
    }

    fn respawn_with_marker(&mut self) {
        let marker = format!("\x1b[?1049l\x1b[0m\r\n[Restarted at {}]\r\n", format_utc(now_millis()));
        self.on_output(Some(marker.into_bytes()));
        if let (Some(spec), Some(cwd)) = (&mut self.spec, &self.status.cwd) {
            spec.cwd = Some(cwd.clone());
        }
        self.spawn();
    }

    fn on_output(&mut self, chunk: Option<Vec<u8>>) {
        let Some(chunk) = chunk else {
            self.output = None;
            return;
        };
        let events = self
            .terminal
            .as_mut()
            .map(|terminal| terminal.feed(&chunk))
            .unwrap_or_default();
        for event in events {
            self.on_terminal_event(event);
        }
        self.gate.push(chunk);
        self.status.last_output_at = Some(now_millis());
        self.status_dirty = true;
    }

    fn on_terminal_event(&mut self, event: TerminalEvent) {
        match event {
            TerminalEvent::Reply(bytes) => {
                if let Some(pty) = &self.pty {
                    pty.reply(bytes);
                }
            }
            TerminalEvent::Title(title) => {
                self.status.title = Some(title);
                self.status_dirty = true;
            }
            TerminalEvent::WorkingDirectory(url) => {
                self.status.cwd = path_from_file_url(&url).or(self.status.cwd.take());
                self.status_dirty = true;
            }
            TerminalEvent::Bell => {}
        }
    }

    fn flush_output(&mut self) {
        let Some(sender) = &self.sender else {
            return;
        };
        while let Some(chunk) = self.gate.next_chunk() {
            if let Ok(encoded) = frame::encode(FrameKind::Output, SESSION_STREAM, &chunk) {
                sender.send(encoded);
            }
        }
    }

    fn flush_status(&mut self) {
        if self.status_dirty {
            self.send_status();
        }
    }

    fn send_status(&mut self) {
        if let Some(cwd) = self.pty.as_ref().and_then(Pty::cwd) {
            self.status.cwd = Some(cwd);
        }
        self.status_dirty = false;
        let event = HolderEvent::Status {
            status: self.status.clone(),
        };
        self.send_event(&event);
    }

    fn send_event(&self, event: &HolderEvent) {
        let Some(sender) = &self.sender else {
            return;
        };
        if let Ok(payload) = serde_json::to_vec(event)
            && let Ok(encoded) = frame::encode(FrameKind::Control, 0, &payload)
        {
            sender.send(encoded);
        }
    }
}

fn spawn_spec(spec: &HolderSpec, size: TerminalSize) -> SpawnSpec {
    let account = Account {
        home: spec.home.clone(),
        user: spec.user.clone(),
        shell: spec.profile.path.clone(),
    };
    SpawnSpec {
        program: spec.profile.path.clone(),
        args: spec.profile.args.clone(),
        login: spec.profile.login,
        cwd: spec.cwd.clone().or_else(|| spec.profile.cwd.clone()),
        env: session_environment(&account, env!("CARGO_PKG_VERSION"), &[&spec.profile.env, &spec.env]),
        size,
    }
}

async fn next_frame(reader: &mut Option<FrameReader<OwnedReadHalf>>) -> io::Result<Option<Frame>> {
    match reader {
        Some(reader) => reader.next().await,
        None => std::future::pending().await,
    }
}

async fn next_chunk(output: &mut Option<mpsc::Receiver<Vec<u8>>>) -> Option<Vec<u8>> {
    match output {
        Some(output) => output.recv().await,
        None => std::future::pending().await,
    }
}

async fn wait_exit(exit: &mut Option<oneshot::Receiver<ExitStatus>>) -> ExitStatus {
    match exit {
        Some(exit) => exit.await.unwrap_or(ExitStatus {
            code: None,
            signal: None,
        }),
        None => std::future::pending().await,
    }
}

async fn stop_deadline(stopping: &Option<Stopping>) {
    match stopping
        .as_ref()
        .and_then(|stopping| Some(stopping.started + stopping.plan.get(stopping.next)?.0))
    {
        Some(deadline) => sleep_until(deadline).await,
        None => std::future::pending().await,
    }
}
