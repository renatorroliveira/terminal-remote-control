//! Upgrading a host's daemon in place (US-2.5.3, D-46): a bridge newer than the running core stops that core and
//! starts its own, which adopts every holder, so no session ends. A core is never replaced by an older one, so two
//! Macs with different app versions never undo each other's upgrade.

use std::fs::File;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use rustix::fs::FlockOperation;
use rustix::process::{Pid, Signal};

use crate::digest::sha256_file;
use crate::install::InstallLayout;
use crate::run_dir::RunDir;
use crate::service::unit_name;

/// How long a core has to exit after it is asked to.
const STOP_TIMEOUT: Duration = Duration::from_secs(5);

/// The core holding `run/core.lock`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunningCore {
    /// Its process.
    pub pid: i32,
    /// Its version, from the lock file or, for an E1 core, its executable.
    pub version: Option<String>,
    /// Its executable, when the OS says.
    pub executable: Option<PathBuf>,
}

/// The contents of `core.lock`: the PID, then from E2 the version and the binary's SHA-256.
pub fn lock_contents(pid: u32, version: &str, sha256: &str) -> String {
    format!("{pid}\n{version}\n{sha256}\n")
}

/// The core that holds the lock, or `None` when no core runs.
pub fn running_core(run: &RunDir) -> Option<RunningCore> {
    let mut file = File::open(run.core_lock()).ok()?;
    if rustix::fs::flock(&file, FlockOperation::NonBlockingLockShared).is_ok() {
        let _ = rustix::fs::flock(&file, FlockOperation::Unlock);
        return None;
    }
    let mut text = String::new();
    file.read_to_string(&mut text).ok()?;
    let mut lines = text.lines();
    let pid = lines.next()?.trim().parse().ok()?;
    let executable = executable_of(pid);
    let version = lines
        .next()
        .map(|line| line.trim().to_owned())
        .filter(|line| !line.is_empty())
        .or_else(|| {
            executable
                .as_deref()
                .filter(|binary| trustworthy(binary))
                .and_then(version_of)
        });
    Some(RunningCore {
        pid,
        version,
        executable,
    })
}

/// Whether `running` should give way to a core of version `own`: only when it is strictly older. A pre-release
/// (`0.3.0-dev`) is older than its release, and a version that cannot be read is never replaced.
pub fn should_replace(running: Option<&str>, own: &str) -> bool {
    match (running.and_then(version_key), version_key(own)) {
        (Some(running), Some(own)) => running < own,
        _ => false,
    }
}

/// Stops the running core so a newer one can take over. Refuses a process whose executable lies outside this
/// install's `versions/`, so a stale PID never gets another program killed. Holders keep running.
pub fn stop_core(core: &RunningCore, layout: &InstallLayout, run: &RunDir) -> io::Result<()> {
    if let Some(executable) = &core.executable
        && !executable.starts_with(&layout.versions)
    {
        return Err(io::Error::other(format!(
            "the core's executable {} is not in this install",
            executable.display()
        )));
    }
    let _ = Command::new("systemctl")
        .args(["--user", "stop", &unit_name(&layout.root)])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    if wait_unlocked(run, Duration::from_millis(200)) {
        return Ok(());
    }
    let pid = Pid::from_raw(core.pid).ok_or_else(|| io::Error::other("the core's PID is not valid"))?;
    let _ = rustix::process::kill_process(pid, Signal::TERM);
    if wait_unlocked(run, STOP_TIMEOUT) {
        return Ok(());
    }
    let _ = rustix::process::kill_process(pid, Signal::KILL);
    if wait_unlocked(run, STOP_TIMEOUT) {
        Ok(())
    } else {
        Err(io::Error::other("the core did not stop"))
    }
}

/// The binary a new core should run: this one, unless a newer version is installed beside it whose checksum still
/// matches its folder's name, so starting a core never downgrades the daemon (US-1.4.6).
pub fn newest_core_binary(layout: &InstallLayout) -> PathBuf {
    let own = env!("CARGO_PKG_VERSION");
    let Ok(entries) = std::fs::read_dir(&layout.versions) else {
        return layout.binary.clone();
    };
    let newest = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path().join("trcd"))
        .filter(|binary| binary != &layout.binary && binary.is_file() && trustworthy(binary))
        .filter_map(|binary| version_of(&binary).map(|version| (binary, version)))
        .filter(|(_, version)| should_replace(Some(own), version))
        .max_by(|(_, a), (_, b)| version_key(a).cmp(&version_key(b)));
    newest.map_or_else(|| layout.binary.clone(), |(binary, _)| binary)
}

/// Whether another installed binary may be run, even just for `--version`: it passes the integrity check every
/// subcommand runs (SEC-04.4), and its SHA-256 still matches its folder's name, `versions/<sha256>/`, as when the app
/// verified it (SEC-04.3). The bootstrap holds installed versions to the same rules.
fn trustworthy(binary: &Path) -> bool {
    let intact = InstallLayout::from_binary(binary)
        .and_then(|layout| layout.check_integrity(rustix::process::geteuid().as_raw()))
        .is_ok();
    let named = binary.parent().and_then(Path::file_name).and_then(|name| name.to_str());
    intact && named.is_some_and(|name| sha256_file(binary).is_ok_and(|sha| sha == name))
}

/// Waits until no core holds the lock.
fn wait_unlocked(run: &RunDir, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if running_core(run).is_none() {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
}

/// The executable of a process, from `/proc` on Linux.
fn executable_of(pid: i32) -> Option<PathBuf> {
    if !cfg!(target_os = "linux") {
        return None;
    }
    std::fs::read_link(format!("/proc/{pid}/exe")).ok()
}

/// The version an installed binary reports through `trcd --version`: `trcd <version> <sha256>`.
fn version_of(binary: &Path) -> Option<String> {
    let output = Command::new(binary)
        .arg("--version")
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    let text = String::from_utf8(output.stdout).ok()?;
    let mut words = text.split_whitespace();
    (words.next() == Some("trcd"))
        .then(|| words.next().map(str::to_owned))
        .flatten()
}

/// Orders versions: the numeric parts, then a release above its pre-releases.
fn version_key(version: &str) -> Option<(Vec<u64>, bool)> {
    let (numbers, pre_release) = match version.split_once('-') {
        Some((numbers, _)) => (numbers, true),
        None => (version, false),
    };
    let parts: Option<Vec<u64>> = numbers.split('.').map(|part| part.parse().ok()).collect();
    let mut parts = parts?;
    while parts.last() == Some(&0) {
        parts.pop();
    }
    Some((parts, !pre_release))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_only_a_strictly_older_core_d_46() {
        assert!(should_replace(Some("0.2.0"), "0.3.0"));
        assert!(should_replace(Some("0.2.0"), "0.3.0-dev"));
        assert!(should_replace(Some("0.3.0-dev"), "0.3.0"));
        assert!(should_replace(Some("0.9.9"), "0.10.0"));
        assert!(!should_replace(Some("0.3.0"), "0.3.0"));
        assert!(!should_replace(Some("0.3.0"), "0.3.0-dev"));
        assert!(!should_replace(Some("0.4.0"), "0.3.0"));
        assert!(!should_replace(Some("0.3"), "0.3.0"));
    }

    #[test]
    fn never_replaces_a_core_whose_version_is_unknown() {
        assert!(!should_replace(None, "9.0.0"));
        assert!(!should_replace(Some("garbage"), "9.0.0"));
    }

    #[test]
    fn writes_the_pid_version_and_checksum() {
        assert_eq!(lock_contents(42, "0.3.0", "ab"), "42\n0.3.0\nab\n");
    }
}
