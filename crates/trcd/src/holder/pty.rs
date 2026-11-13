//! A shell in a pseudo-terminal: spawning, input, output, resizing and signals.
//!
//! Output is read on a dedicated thread into a small bounded channel. When the event loop stops receiving, the
//! thread blocks, the PTY stops being read and the program blocks on its writes (D-19).
//!
//! The child is set up with raw system calls only between `fork` and `exec` (`setsid`, `TIOCSCTTY`), because the
//! holder is multithreaded and allocating there can deadlock or crash (D-23).

use std::collections::BTreeMap;
use std::fs::File;
use std::io::{Read, Write};
use std::os::fd::{BorrowedFd, OwnedFd};
use std::os::unix::process::{CommandExt, ExitStatusExt};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc as std_mpsc;

use rustix::process::{Pid, Signal, ioctl_tiocsctty, kill_process, kill_process_group, setsid};
use rustix::pty::{OpenptFlags, grantpt, openpt, ptsname, unlockpt};
use rustix::termios::{InputModes, OptionalActions, Winsize, tcgetattr, tcsetattr, tcsetwinsize};
use thiserror::Error;
use tokio::sync::{mpsc, oneshot};
use trc_protocol::{ExitStatus, TerminalSize};

use super::stop_plan::StopSignal;

/// Bytes read from the PTY in one go.
const READ_SIZE: usize = 32 * 1024;

/// What to run in the PTY.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpawnSpec {
    /// Absolute path of the program.
    pub program: String,
    /// Arguments after the program name.
    pub args: Vec<String>,
    /// Start as a login shell (`argv[0]` of `-bash`).
    pub login: bool,
    /// The working directory; `HOME` when absent or missing.
    pub cwd: Option<String>,
    /// The complete environment; nothing else is inherited.
    pub env: BTreeMap<String, String>,
    /// The initial size.
    pub size: TerminalSize,
}

/// XNU's internal "redrive the open" status, which concurrent `/dev/ptmx` opens can leak to user space.
#[cfg(not(target_os = "linux"))]
const REDRIVE_OPEN: i32 = -6;
/// How many times a redriven `/dev/ptmx` open is attempted.
#[cfg(not(target_os = "linux"))]
const OPEN_ATTEMPTS: u32 = 16;

/// Why a process could not start.
#[derive(Debug, Error)]
#[error("{0}")]
pub struct SpawnError(String);

impl From<std::io::Error> for SpawnError {
    fn from(error: std::io::Error) -> Self {
        Self(error.to_string())
    }
}

impl From<rustix::io::Errno> for SpawnError {
    fn from(error: rustix::io::Errno) -> Self {
        Self(std::io::Error::from(error).to_string())
    }
}

/// The running process's output and exit.
pub struct PtyOutput {
    /// Chunks of output, closed when the PTY reaches end of file.
    pub chunks: mpsc::Receiver<Vec<u8>>,
    /// The exit status, sent once when the process ends.
    pub exit: oneshot::Receiver<ExitStatus>,
}

/// A process running in a pseudo-terminal.
pub struct Pty {
    master: OwnedFd,
    input: std_mpsc::Sender<Input>,
    replies: Arc<AtomicUsize>,
    pid: u32,
}

/// The most reply bytes that may wait for the program, such as answers to cursor-position queries, so output full
/// of queries cannot grow the holder while the program reads no input (SEC-06, NFR-09). Replies over it are dropped,
/// as a terminal may.
pub const REPLY_BUDGET: usize = 64 * 1024;

/// Bytes for the program: what the user typed, or the emulator's reply to a query.
enum Input {
    Typed(Vec<u8>),
    Reply(Vec<u8>),
}

impl Pty {
    /// Starts `spec.program` in a new PTY as the leader of its own session, with the PTY as its controlling terminal.
    pub fn spawn(spec: &SpawnSpec) -> Result<(Self, PtyOutput), SpawnError> {
        let master = open_master()?;
        grantpt(&master)?;
        unlockpt(&master)?;
        let slave = open_slave(&master)?;
        tcsetwinsize(&slave, winsize(spec.size))?;
        mark_utf8(&slave)?;
        let mut child = command(spec, &slave)?.spawn()?;
        drop(slave);
        let pid = child.id();
        let reader = File::from(master.try_clone()?);
        let writer = File::from(master.try_clone()?);
        let (chunks_tx, chunks) = mpsc::channel(2);
        let (exit_tx, exit) = oneshot::channel();
        let (input, input_rx) = std_mpsc::channel();
        let replies = Arc::new(AtomicUsize::new(0));
        let queued = Arc::clone(&replies);
        std::thread::spawn(move || read_output(reader, &chunks_tx));
        std::thread::spawn(move || write_input(writer, &input_rx, &queued));
        std::thread::spawn(move || {
            let status = child.wait().map_or(
                ExitStatus {
                    code: None,
                    signal: None,
                },
                exit_status,
            );
            let _ = exit_tx.send(status);
        });
        Ok((
            Self {
                master,
                input,
                replies,
                pid,
            },
            PtyOutput { chunks, exit },
        ))
    }

    /// Queues input for the process. Input never waits behind output.
    pub fn write(&self, bytes: Vec<u8>) {
        let _ = self.input.send(Input::Typed(bytes));
    }

    /// Queues the emulator's reply to a query, or drops it when [`REPLY_BUDGET`] bytes already wait.
    pub fn reply(&self, bytes: Vec<u8>) {
        if self.replies.load(Ordering::Acquire) + bytes.len() > REPLY_BUDGET {
            return;
        }
        self.replies.fetch_add(bytes.len(), Ordering::AcqRel);
        let _ = self.input.send(Input::Reply(bytes));
    }

    /// Reply bytes queued and not yet written to the program.
    pub fn queued_reply_bytes(&self) -> usize {
        self.replies.load(Ordering::Acquire)
    }

    /// Resizes the PTY, which sends `SIGWINCH` to the foreground process group (US-1.11.3).
    pub fn resize(&self, size: TerminalSize) -> Result<(), SpawnError> {
        Ok(tcsetwinsize(&self.master, winsize(size))?)
    }

    /// Sends one signal of the stop sequence: hangup and terminate go to the shell, kill to its process group.
    pub fn signal(&self, signal: StopSignal) {
        let Some(pid) = i32::try_from(self.pid).ok().and_then(Pid::from_raw) else {
            return;
        };
        let _ = match signal {
            StopSignal::Hangup => kill_process(pid, Signal::HUP),
            StopSignal::Terminate => kill_process(pid, Signal::TERM),
            StopSignal::Kill => kill_process_group(pid, Signal::KILL),
        };
    }

    /// The process ID.
    pub fn pid(&self) -> u32 {
        self.pid
    }

    /// The process's working directory from the OS, where the OS exposes it (`/proc` on Linux).
    pub fn cwd(&self) -> Option<String> {
        process_cwd(self.pid)
    }
}

#[cfg(target_os = "linux")]
fn open_master() -> Result<OwnedFd, SpawnError> {
    Ok(openpt(OpenptFlags::RDWR | OpenptFlags::NOCTTY | OpenptFlags::CLOEXEC)?)
}

#[cfg(not(target_os = "linux"))]
fn open_master() -> Result<OwnedFd, SpawnError> {
    let master = retry_redriven_open(|| openpt(OpenptFlags::RDWR | OpenptFlags::NOCTTY))?;
    rustix::io::fcntl_setfd(&master, rustix::io::FdFlags::CLOEXEC)?;
    Ok(master)
}

#[cfg(not(target_os = "linux"))]
fn retry_redriven_open<T>(mut open: impl FnMut() -> rustix::io::Result<T>) -> rustix::io::Result<T> {
    let mut attempt = 1;
    loop {
        match open() {
            Err(error) if error.raw_os_error() == REDRIVE_OPEN && attempt < OPEN_ATTEMPTS => attempt += 1,
            result => return result,
        }
    }
}

fn open_slave(master: &OwnedFd) -> Result<OwnedFd, SpawnError> {
    let name = ptsname(master, Vec::new())?;
    let flags = rustix::fs::OFlags::RDWR | rustix::fs::OFlags::NOCTTY | rustix::fs::OFlags::CLOEXEC;
    Ok(rustix::fs::open(name.as_c_str(), flags, rustix::fs::Mode::empty())?)
}

fn command(spec: &SpawnSpec, slave: &OwnedFd) -> Result<Command, SpawnError> {
    let mut command = Command::new(&spec.program);
    command.args(&spec.args);
    if spec.login {
        let name = Path::new(&spec.program)
            .file_name()
            .map_or(spec.program.as_str(), |n| n.to_str().unwrap_or("sh"));
        command.arg0(format!("-{name}"));
    }
    command.env_clear().envs(&spec.env).current_dir(working_directory(spec));
    command.stdin(Stdio::from(slave.try_clone()?));
    command.stdout(Stdio::from(slave.try_clone()?));
    command.stderr(Stdio::from(slave.try_clone()?));
    // SAFETY: the closure runs between fork and exec and makes only async-signal-safe system calls, with no
    // allocation. std has already dup'ed the PTY slave onto descriptors 0, 1 and 2.
    unsafe {
        command.pre_exec(|| {
            setsid()?;
            ioctl_tiocsctty(BorrowedFd::borrow_raw(0))?;
            Ok(())
        });
    }
    Ok(command)
}

fn working_directory(spec: &SpawnSpec) -> String {
    spec.cwd
        .clone()
        .filter(|cwd| Path::new(cwd).is_dir())
        .or_else(|| spec.env.get("HOME").cloned())
        .unwrap_or_else(|| "/".into())
}

/// Tells the line discipline that input is UTF-8, so erase in canonical mode removes a whole character (`IUTF8`).
fn mark_utf8(slave: &OwnedFd) -> Result<(), SpawnError> {
    let mut termios = tcgetattr(slave)?;
    termios.input_modes.insert(InputModes::IUTF8);
    Ok(tcsetattr(slave, OptionalActions::Now, &termios)?)
}

fn winsize(size: TerminalSize) -> Winsize {
    Winsize {
        ws_row: size.rows,
        ws_col: size.cols,
        ws_xpixel: 0,
        ws_ypixel: 0,
    }
}

fn exit_status(status: std::process::ExitStatus) -> ExitStatus {
    match status.signal() {
        Some(signal) => ExitStatus {
            code: None,
            signal: Some(signal_name(signal)),
        },
        None => ExitStatus {
            code: status.code(),
            signal: None,
        },
    }
}

/// Returns the conventional name of a signal number.
pub fn signal_name(signal: i32) -> String {
    let name = match signal {
        1 => "SIGHUP",
        2 => "SIGINT",
        3 => "SIGQUIT",
        6 => "SIGABRT",
        9 => "SIGKILL",
        11 => "SIGSEGV",
        13 => "SIGPIPE",
        15 => "SIGTERM",
        _ => return format!("signal {signal}"),
    };
    name.to_owned()
}

fn read_output(mut reader: File, chunks: &mpsc::Sender<Vec<u8>>) {
    let mut buffer = vec![0; READ_SIZE];
    while let Ok(read) = reader.read(&mut buffer) {
        if read == 0 || chunks.blocking_send(buffer[..read].to_vec()).is_err() {
            break;
        }
    }
}

fn write_input(mut writer: File, input: &std_mpsc::Receiver<Input>, replies: &AtomicUsize) {
    while let Ok(next) = input.recv() {
        let written = match &next {
            Input::Typed(bytes) | Input::Reply(bytes) => writer.write_all(bytes).and_then(|()| writer.flush()),
        };
        if let Input::Reply(bytes) = &next {
            replies.fetch_sub(bytes.len(), Ordering::AcqRel);
        }
        if written.is_err() {
            break;
        }
    }
}

#[cfg(target_os = "linux")]
fn process_cwd(pid: u32) -> Option<String> {
    std::fs::read_link(format!("/proc/{pid}/cwd"))
        .ok()
        .map(|path| path.to_string_lossy().into_owned())
}

#[cfg(not(target_os = "linux"))]
fn process_cwd(_pid: u32) -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;

    fn spec(script: &str) -> SpawnSpec {
        SpawnSpec {
            program: "/bin/sh".into(),
            args: vec!["-c".into(), script.into()],
            login: false,
            cwd: None,
            env: BTreeMap::from([("TERM".into(), "xterm-256color".into()), ("HOME".into(), "/tmp".into())]),
            size: TerminalSize { cols: 100, rows: 30 },
        }
    }

    async fn run(pty_output: &mut PtyOutput) -> (String, ExitStatus) {
        let mut text = Vec::new();
        while let Some(chunk) = pty_output.chunks.recv().await {
            text.extend(chunk);
        }
        let status = (&mut pty_output.exit).await.unwrap();
        (String::from_utf8_lossy(&text).into_owned(), status)
    }

    #[tokio::test]
    async fn keeps_replies_within_their_budget_while_the_program_reads_nothing() {
        let (pty, _output) = Pty::spawn(&spec("stty raw -echo; sleep 3")).unwrap();
        tokio::time::sleep(Duration::from_millis(300)).await;
        for _ in 0..10_000 {
            pty.reply(vec![b'r'; 1_024]);
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert!(
            pty.queued_reply_bytes() <= REPLY_BUDGET,
            "{} bytes queued",
            pty.queued_reply_bytes()
        );
    }

    #[tokio::test]
    async fn runs_a_program_with_only_the_given_environment() {
        let (_pty, mut output) = Pty::spawn(&spec(
            "echo \"term=$TERM user=${USER:-none} cargo=${CARGO:-none} size=$(stty size)\"; exit 3",
        ))
        .unwrap();
        let (text, status) = run(&mut output).await;
        assert!(
            text.contains("term=xterm-256color user=none cargo=none size=30 100"),
            "{text:?}"
        );
        assert_eq!(
            status,
            ExitStatus {
                code: Some(3),
                signal: None
            }
        );
    }

    #[tokio::test]
    async fn marks_the_pty_as_utf_8_so_erase_removes_whole_characters() {
        let (_pty, mut output) = Pty::spawn(&spec("stty -a")).unwrap();
        let (text, _) = run(&mut output).await;
        assert!(text.split_whitespace().any(|flag| flag == "iutf8"), "{text:?}");
    }

    #[tokio::test]
    async fn resizes_the_pty() {
        let (pty, mut output) = Pty::spawn(&spec("sleep 0.5; stty size")).unwrap();
        pty.resize(TerminalSize { cols: 132, rows: 43 }).unwrap();
        let (text, _) = run(&mut output).await;
        assert!(text.contains("43 132"), "{text:?}");
    }

    #[tokio::test]
    async fn delivers_input_to_the_process() {
        let (pty, mut output) = Pty::spawn(&spec("read line; echo \"got:$line\"")).unwrap();
        pty.write(b"hello\r".to_vec());
        let (text, _) = run(&mut output).await;
        assert!(text.contains("got:hello"), "{text:?}");
    }

    #[tokio::test]
    async fn kills_the_process_group() {
        let (pty, mut output) = Pty::spawn(&spec("trap '' HUP TERM; echo ready; sleep 30")).unwrap();
        assert!(
            output
                .chunks
                .recv()
                .await
                .is_some_and(|chunk| String::from_utf8_lossy(&chunk).contains("ready"))
        );
        pty.signal(StopSignal::Hangup);
        pty.signal(StopSignal::Terminate);
        tokio::time::sleep(Duration::from_millis(200)).await;
        pty.signal(StopSignal::Kill);
        let status = tokio::time::timeout(Duration::from_secs(5), &mut output.exit)
            .await
            .unwrap()
            .unwrap();
        assert!(status.signal.is_some() || status.code.is_some(), "{status:?}");
    }

    #[test]
    fn spawns_safely_from_many_threads_at_once() {
        let threads: Vec<_> = (0..16)
            .map(|index| {
                std::thread::spawn(move || {
                    let runtime = tokio::runtime::Builder::new_current_thread()
                        .enable_all()
                        .build()
                        .unwrap();
                    runtime.block_on(async move {
                        let (_pty, mut output) = Pty::spawn(&spec(&format!("echo thread-{index}"))).unwrap();
                        let (text, status) = run(&mut output).await;
                        assert!(text.contains(&format!("thread-{index}")), "{text:?}");
                        assert_eq!(status.code, Some(0));
                    });
                })
            })
            .collect();
        for thread in threads {
            thread.join().unwrap();
        }
    }

    #[cfg(not(target_os = "linux"))]
    #[test]
    fn retries_a_redriven_ptmx_open_a_bounded_number_of_times() {
        let redrive = rustix::io::Errno::from_raw_os_error(REDRIVE_OPEN);
        let mut failures = 3;
        let recovered = retry_redriven_open(|| {
            failures -= 1;
            if failures > 0 { Err(redrive) } else { Ok(failures) }
        });
        assert_eq!(recovered, Ok(0));
        let mut calls = 0;
        let exhausted: rustix::io::Result<()> = retry_redriven_open(|| {
            calls += 1;
            Err(redrive)
        });
        assert_eq!(exhausted, Err(redrive));
        assert_eq!(calls, OPEN_ATTEMPTS);
        let mut other_calls = 0;
        let other: rustix::io::Result<()> = retry_redriven_open(|| {
            other_calls += 1;
            Err(rustix::io::Errno::NOENT)
        });
        assert_eq!(other, Err(rustix::io::Errno::NOENT));
        assert_eq!(other_calls, 1);
    }

    #[test]
    fn names_common_signals() {
        assert_eq!(signal_name(9), "SIGKILL");
        assert_eq!(signal_name(64), "signal 64");
    }

    #[tokio::test]
    async fn reports_a_missing_program() {
        let mut missing = spec("");
        missing.program = "/nonexistent/shell".into();
        missing.args.clear();
        assert!(Pty::spawn(&missing).is_err());
    }
}
