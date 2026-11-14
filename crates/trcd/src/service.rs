//! How the core runs on this host, which decides whether sessions outlive logout (US-2.4, D-44, S11).
//!
//! The app uses systemd only as the host already has it. With lingering on, or where logind ends a user's processes
//! at logout, the core runs as a transient user unit that systemd restarts after a crash, and each holder in its own
//! transient scope, outside the unit's control group. Otherwise the core runs detached, as in E1.

use std::io;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};

/// How long one probe of the host's systemd or logind may take.
const PROBE_TIMEOUT: Duration = Duration::from_secs(3);

/// What the host says about the user's systemd and logind.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct HostFacts {
    /// The user's systemd instance answers `systemctl --user`.
    pub user_manager: bool,
    /// logind keeps the user's systemd instance running without a login (`Linger=yes`).
    pub linger: bool,
    /// logind ends the user's processes when their login session ends (`KillUserProcesses=yes`, for this user).
    pub kill_user_processes: bool,
}

/// How the core runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServiceMode {
    /// A transient systemd user unit, restarted on failure, with holders in transient scopes.
    Systemd,
    /// Detached from the connection that started it, in its own session.
    Detached,
}

impl HostFacts {
    /// The mode D-44 picks: systemd when it keeps sessions longer than detaching would.
    pub fn mode(&self) -> ServiceMode {
        if self.user_manager && (self.linger || self.kill_user_processes) {
            ServiceMode::Systemd
        } else {
            ServiceMode::Detached
        }
    }

    /// Whether the host ends sessions once the last connection closes (US-2.4.4).
    pub fn sessions_end_at_logout(&self) -> bool {
        self.kill_user_processes && !self.linger
    }
}

/// Asks the host's systemd and logind about `user`; a probe that fails or is missing counts as no.
pub fn read_host_facts(user: &str, uid: u32) -> HostFacts {
    if !cfg!(target_os = "linux") {
        return HostFacts::default();
    }
    let user_manager = probe("systemctl", &["--user", "show", "--property=Version", "--value"]).is_some();
    let linger = probe(
        "loginctl",
        &["show-user", &uid.to_string(), "--property=Linger", "--value"],
    )
    .is_some_and(|output| output.trim() == "yes");
    HostFacts {
        user_manager,
        linger,
        kill_user_processes: kills_user_processes(user),
    }
}

/// The transient unit's name for an install root, so two install roots never share a core.
pub fn unit_name(root: &Path) -> String {
    let digest = Sha256::digest(root.as_os_str().as_encoded_bytes());
    let hex: String = digest.iter().take(4).map(|byte| format!("{byte:02x}")).collect();
    format!("trcd-{hex}.service")
}

/// Starts `binary core --systemd` as a transient user unit restarted on failure, with the caller's umask and account
/// environment. A refused start (75: another core runs; 78: an untrusted install) is not retried.
pub fn start_unit(binary: &Path, root: &Path, umask: u32) -> io::Result<()> {
    let mut command = Command::new("systemd-run");
    command
        .args(["--user", "--collect", "--quiet"])
        .arg(format!("--unit={}", unit_name(root)))
        .args([
            "--property=Restart=on-failure",
            "--property=RestartSec=1",
            "--property=RestartPreventExitStatus=75 78",
        ])
        .arg(format!("--property=UMask={umask:04o}"));
    for name in ["HOME", "USER", "LOGNAME", "SHELL", "PATH"] {
        if let Some(value) = std::env::var_os(name) {
            let mut setting = std::ffi::OsString::from(format!("--setenv={name}="));
            setting.push(value);
            command.arg(setting);
        }
    }
    let status = command
        .arg("--")
        .arg(binary)
        .args(["core", "--systemd"])
        .current_dir("/")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()?;
    if status.success() {
        Ok(())
    } else {
        Err(io::Error::other(format!(
            "systemd-run did not start the core ({status})"
        )))
    }
}

/// What a core running as a unit needs to start holders in their own scopes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScopeLauncher {
    /// `systemd-run`, by absolute path, as holders start with an empty environment.
    pub program: PathBuf,
    /// The variables `systemd-run` needs to reach the user's systemd instance.
    pub env: Vec<(String, String)>,
}

impl ScopeLauncher {
    /// Finds `systemd-run` on `PATH` and the variables that lead it to the user's systemd instance.
    pub fn find() -> Option<Self> {
        let program = std::env::var_os("PATH")
            .into_iter()
            .flat_map(|path| std::env::split_paths(&path).collect::<Vec<_>>())
            .map(|dir| dir.join("systemd-run"))
            .find(|candidate| candidate.is_file())?;
        let env = ["XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"]
            .into_iter()
            .filter_map(|name| std::env::var(name).ok().map(|value| (name.to_owned(), value)))
            .collect();
        Some(Self { program, env })
    }

    /// The arguments that run `binary holder --socket <socket>` in a new transient scope named after the session.
    pub fn arguments(&self, session: &str, binary: &Path, socket: &Path) -> Vec<std::ffi::OsString> {
        let mut args: Vec<std::ffi::OsString> = ["--user", "--scope", "--collect", "--quiet"]
            .into_iter()
            .map(Into::into)
            .collect();
        args.push(format!("--unit=trcd-holder-{session}").into());
        args.push("--".into());
        args.push(binary.into());
        args.extend(["holder", "--socket"].into_iter().map(Into::into));
        args.push(socket.into());
        args
    }
}

/// Whether logind's `KillUserProcesses` applies to `user`, after `KillExcludeUsers` and `KillOnlyUsers`.
fn kills_user_processes(user: &str) -> bool {
    let property = |name: &str| {
        probe(
            "busctl",
            &[
                "get-property",
                "org.freedesktop.login1",
                "/org/freedesktop/login1",
                "org.freedesktop.login1.Manager",
                name,
            ],
        )
    };
    let kills = property("KillUserProcesses").and_then(|output| parse_bool_property(&output));
    let excluded = property("KillExcludeUsers").map(|output| parse_string_array(&output));
    let only = property("KillOnlyUsers").map(|output| parse_string_array(&output));
    kill_applies(kills == Some(true), excluded.as_deref(), only.as_deref(), user)
}

fn kill_applies(kills: bool, excluded: Option<&[String]>, only: Option<&[String]>, user: &str) -> bool {
    let listed = |users: Option<&[String]>| users.is_some_and(|users| users.iter().any(|name| name == user));
    let restricted = only.is_some_and(|users| !users.is_empty());
    kills && !listed(excluded) && (!restricted || listed(only))
}

/// Parses `busctl get-property` output for a boolean, such as `b true`.
fn parse_bool_property(output: &str) -> Option<bool> {
    match output.trim().strip_prefix("b ")? {
        "true" => Some(true),
        "false" => Some(false),
        _ => None,
    }
}

/// Parses `busctl get-property` output for a string array, such as `as 2 "root" "bob"`.
fn parse_string_array(output: &str) -> Vec<String> {
    output.split('"').skip(1).step_by(2).map(str::to_owned).collect()
}

/// Runs a probe and returns its standard output when it succeeds within [`PROBE_TIMEOUT`].
fn probe(program: &str, args: &[&str]) -> Option<String> {
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let deadline = Instant::now() + PROBE_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break,
            Ok(Some(_)) | Err(_) => return None,
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(10)),
        }
    }
    let mut output = String::new();
    std::io::Read::read_to_string(&mut child.stdout.take()?, &mut output).ok()?;
    Some(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn facts(user_manager: bool, linger: bool, kill_user_processes: bool) -> HostFacts {
        HostFacts {
            user_manager,
            linger,
            kill_user_processes,
        }
    }

    #[test]
    fn runs_under_systemd_with_lingering_or_where_logout_kills_d_44() {
        assert_eq!(facts(true, true, false).mode(), ServiceMode::Systemd);
        assert_eq!(facts(true, false, true).mode(), ServiceMode::Systemd);
        assert_eq!(facts(true, false, false).mode(), ServiceMode::Detached);
        assert_eq!(facts(false, true, true).mode(), ServiceMode::Detached);
    }

    #[test]
    fn sessions_end_at_logout_only_where_logout_kills_without_lingering_us_2_4_4() {
        assert!(facts(true, false, true).sessions_end_at_logout());
        assert!(facts(false, false, true).sessions_end_at_logout());
        assert!(!facts(true, true, true).sessions_end_at_logout());
        assert!(!facts(true, false, false).sessions_end_at_logout());
    }

    #[test]
    fn reads_busctl_properties() {
        assert_eq!(parse_bool_property("b true\n"), Some(true));
        assert_eq!(parse_bool_property("b false"), Some(false));
        assert_eq!(parse_bool_property("s \"x\""), None);
        assert_eq!(parse_string_array("as 2 \"root\" \"bob\"\n"), ["root", "bob"]);
        assert!(parse_string_array("as 0\n").is_empty());
    }

    #[test]
    fn applies_kill_user_processes_after_the_exclusions() {
        let users = |names: &[&str]| names.iter().map(|name| (*name).to_owned()).collect::<Vec<_>>();
        let root = users(&["root"]);
        assert!(kill_applies(true, Some(&root), Some(&[]), "tester"));
        assert!(!kill_applies(true, Some(&root), Some(&[]), "root"));
        assert!(!kill_applies(true, None, Some(&users(&["alice"])), "tester"));
        assert!(kill_applies(true, None, Some(&users(&["tester"])), "tester"));
        assert!(!kill_applies(false, None, None, "tester"));
    }

    #[test]
    fn names_the_unit_after_the_install_root() {
        let name = unit_name(Path::new("/home/tester/.trc"));
        assert!(
            name.starts_with("trcd-") && name.ends_with(".service") && name.len() == 21,
            "{name}"
        );
        assert_ne!(name, unit_name(Path::new("/var/tmp/trc-1000")));
    }

    #[test]
    fn starts_a_holder_in_a_scope_named_after_its_session() {
        let launcher = ScopeLauncher {
            program: "/usr/bin/systemd-run".into(),
            env: vec![],
        };
        let args = launcher.arguments(
            "0123456789abcdef",
            Path::new("/r/versions/x/trcd"),
            Path::new("/r/run/holders/0123456789abcdef.sock"),
        );
        let text: Vec<String> = args.iter().map(|arg| arg.to_string_lossy().into_owned()).collect();
        assert_eq!(
            text,
            [
                "--user",
                "--scope",
                "--collect",
                "--quiet",
                "--unit=trcd-holder-0123456789abcdef",
                "--",
                "/r/versions/x/trcd",
                "holder",
                "--socket",
                "/r/run/holders/0123456789abcdef.sock"
            ]
        );
    }
}
