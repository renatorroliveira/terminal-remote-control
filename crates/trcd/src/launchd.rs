//! The core as a per-user launchd LaunchAgent on macOS (D-50, P-55, P-60, P-61): a plist in
//! `~/Library/LaunchAgents` that runs the installed binary at login, again after a crash, and never ends a holder.

use std::ffi::{OsStr, OsString};
use std::fmt::Write as _;
use std::io;
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::time::Duration;

use rustix::fs::Mode;

use crate::private_dir::ensure_private_dir;
use crate::service::{probe, root_hash8, succeeds};

/// The variables the core's agent passes on from the bridge that registered it, as the systemd unit does.
const PASSED_ENV: [&str; 5] = ["HOME", "USER", "LOGNAME", "SHELL", "PATH"];
/// How often a bootstrap right after a `bootout`, or a kickstart right after a crash, is tried, as launchd may still
/// be handling the old core.
const BOOTSTRAP_ATTEMPTS: u32 = 10;
const BOOTSTRAP_RETRY: Duration = Duration::from_millis(300);

/// What a LaunchAgent for the core holds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentSpec {
    /// `dev.trc.trcd-<hash8>` (P-60).
    pub label: String,
    /// The installed `versions/<sha256>/trcd`.
    pub binary: PathBuf,
    /// Where launchd writes the core's standard error.
    pub log: PathBuf,
    /// The umask holders get back, the bridge's.
    pub umask: u32,
    /// The variables the core starts with.
    pub env: Vec<(String, OsString)>,
}

/// What registering the agent takes, given what launchd has loaded and what its plist says.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentStep {
    /// Write the plist and `bootstrap` it.
    Bootstrap,
    /// The loaded agent is the one wanted: `kickstart` it, which starts its core unless it runs.
    Kickstart,
    /// `bootout` the loaded agent, which ends its core but no holder, then write and `bootstrap` the plist.
    Replace,
}

/// The agent's label for an install root, named as its systemd unit is.
pub fn agent_label(root: &Path) -> String {
    format!("dev.trc.trcd-{}", root_hash8(root))
}

/// Where the agent's plist lives under `home`.
pub fn plist_path(home: &Path, label: &str) -> PathBuf {
    home.join("Library/LaunchAgents").join(format!("{label}.plist"))
}

/// The plist's text: the core with `--launchd`, started at load (login) and within a second of any unsuccessful exit,
/// as the systemd unit's `RestartSec=1` is, rather than after launchd's default 10 s, never ending the processes it
/// started, with the bridge's environment and umask.
pub fn agent_plist(spec: &AgentSpec) -> String {
    let mut text = String::from(concat!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n",
        "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n",
        "<plist version=\"1.0\">\n<dict>\n",
    ));
    entry(&mut text, "Label", &string(&spec.label));
    let arguments = [spec.binary.as_os_str(), OsStr::new("core"), OsStr::new("--launchd")]
        .map(|argument| format!("\t\t{}\n", string(&argument.to_string_lossy())));
    entry(
        &mut text,
        "ProgramArguments",
        &format!("<array>\n{}\t</array>", arguments.concat()),
    );
    let variables: String = spec
        .env
        .iter()
        .map(|(name, value)| {
            format!(
                "\t\t<key>{}</key>\n\t\t{}\n",
                escape(name),
                string(&value.to_string_lossy())
            )
        })
        .collect();
    entry(
        &mut text,
        "EnvironmentVariables",
        &format!("<dict>\n{variables}\t</dict>"),
    );
    entry(&mut text, "WorkingDirectory", &string("/"));
    entry(&mut text, "Umask", &format!("<integer>{}</integer>", spec.umask));
    entry(&mut text, "RunAtLoad", "<true/>");
    entry(
        &mut text,
        "KeepAlive",
        "<dict>\n\t\t<key>SuccessfulExit</key>\n\t\t<false/>\n\t</dict>",
    );
    entry(&mut text, "AbandonProcessGroup", "<true/>");
    entry(&mut text, "ThrottleInterval", "<integer>1</integer>");
    entry(&mut text, "ProcessType", &string("Interactive"));
    entry(&mut text, "StandardErrorPath", &string(&spec.log.to_string_lossy()));
    text.push_str("</dict>\n</plist>\n");
    text
}

/// The step that brings launchd to the agent wanted, from whether one is loaded and the plist written last.
pub fn next_step(loaded: bool, written: Option<&str>, wanted: &str) -> AgentStep {
    match (loaded, written) {
        (false, _) => AgentStep::Bootstrap,
        (true, Some(text)) if text == wanted => AgentStep::Kickstart,
        (true, _) => AgentStep::Replace,
    }
}

/// Whether the user has a GUI login session, the `gui/<uid>` domain a LaunchAgent needs (P-61).
pub fn has_gui_session(uid: u32) -> bool {
    cfg!(target_os = "macos") && succeeds("launchctl", &["print", &format!("gui/{uid}")])
}

/// Registers the core for `root` as a LaunchAgent running `binary` and starts it (P-60), with its standard error in
/// the install's private `logs/`. The holders of a core it replaces keep running, and the new core adopts them.
pub fn start_agent(binary: &Path, root: &Path, umask: Mode, home: &Path) -> io::Result<()> {
    let uid = rustix::process::geteuid().as_raw();
    let logs = root.join("logs");
    ensure_private_dir(&logs, uid)?;
    let spec = AgentSpec {
        label: agent_label(root),
        binary: binary.to_owned(),
        log: logs.join("launchd.log"),
        umask: u32::from(umask.bits()),
        env: PASSED_ENV
            .iter()
            .filter_map(|name| std::env::var_os(name).map(|value| ((*name).to_owned(), value)))
            .collect(),
    };
    let wanted = agent_plist(&spec);
    let file = plist_path(home, &spec.label);
    let service = format!("gui/{uid}/{}", spec.label);
    let loaded = succeeds("launchctl", &["print", &service]);
    let written = std::fs::read_to_string(&file).ok();
    match next_step(loaded, written.as_deref(), &wanted) {
        AgentStep::Kickstart => kickstart(&service),
        AgentStep::Replace => {
            stop_agent(root);
            bootstrap(uid, &file, &wanted)
        }
        AgentStep::Bootstrap => bootstrap(uid, &file, &wanted),
    }
}

/// Whether launchd runs the core's agent for `root`, or is about to start it again after it ended, so a new core
/// comes up in it and starting another one elsewhere would leave it no lock to take.
pub fn agent_is_running(root: &Path) -> bool {
    let uid = rustix::process::geteuid().as_raw();
    probe("launchctl", &["print", &format!("gui/{uid}/{}", agent_label(root))])
        .is_some_and(|text| starts_or_runs(&text))
}

/// Whether `launchctl print` says its service runs or is scheduled to start, from the service's own `state` line.
pub fn starts_or_runs(print: &str) -> bool {
    print
        .lines()
        .any(|line| matches!(line, "\tstate = running" | "\tstate = spawn scheduled"))
}

/// Unloads the core's agent for `root`, which ends its core but no holder, and leaves its plist for the next start
/// to rewrite. Does nothing where no such agent is loaded.
pub fn stop_agent(root: &Path) {
    if cfg!(target_os = "macos") {
        let uid = rustix::process::geteuid().as_raw();
        let _ = succeeds("launchctl", &["bootout", &format!("gui/{uid}/{}", agent_label(root))]);
    }
}

/// Starts a loaded agent's core, trying again for a moment while launchd still handles a core that just ended.
fn kickstart(service: &str) -> io::Result<()> {
    for attempt in 1..=BOOTSTRAP_ATTEMPTS {
        if succeeds("launchctl", &["kickstart", service]) {
            return Ok(());
        }
        if attempt < BOOTSTRAP_ATTEMPTS {
            std::thread::sleep(BOOTSTRAP_RETRY);
        }
    }
    Err(io::Error::other("launchctl kickstart did not start the core's agent"))
}

/// Writes the plist, readable and writable only by the user, then loads it, trying again for a moment while launchd
/// still removes an agent just booted out.
fn bootstrap(uid: u32, file: &Path, text: &str) -> io::Result<()> {
    if let Some(folder) = file.parent() {
        std::fs::create_dir_all(folder)?;
    }
    write_private(file, text)?;
    let domain = format!("gui/{uid}");
    let path = file.to_string_lossy();
    for attempt in 1..=BOOTSTRAP_ATTEMPTS {
        if succeeds("launchctl", &["bootstrap", &domain, &path]) {
            return Ok(());
        }
        if attempt < BOOTSTRAP_ATTEMPTS {
            std::thread::sleep(BOOTSTRAP_RETRY);
        }
    }
    Err(io::Error::other("launchctl bootstrap did not load the core's agent"))
}

fn write_private(file: &Path, text: &str) -> io::Result<()> {
    let temporary = file.with_extension("plist.new");
    let mut options = std::fs::OpenOptions::new();
    options.create(true).write(true).truncate(true).mode(0o600);
    io::Write::write_all(&mut options.open(&temporary)?, text.as_bytes())?;
    std::fs::rename(&temporary, file)
}

fn entry(text: &mut String, key: &str, value: &str) {
    let _ = writeln!(text, "\t<key>{key}</key>\n\t{value}");
}

fn string(value: &str) -> String {
    format!("<string>{}</string>", escape(value))
}

fn escape(value: &str) -> String {
    value.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;

    fn spec() -> AgentSpec {
        AgentSpec {
            label: agent_label(Path::new("/home/tester/.trc")),
            binary: "/home/tester/.trc/versions/abc/trcd".into(),
            log: "/home/tester/.trc/logs/launchd.log".into(),
            umask: 0o022,
            env: vec![
                ("HOME".into(), "/home/tester".into()),
                ("PATH".into(), "/usr/bin:/bin".into()),
                ("SHELL".into(), "/bin/zsh & <co>".into()),
            ],
        }
    }

    #[test]
    fn names_the_agent_after_its_install_root_as_the_systemd_unit_is() {
        let label = agent_label(Path::new("/home/tester/.trc"));
        assert_eq!(
            label,
            format!(
                "dev.trc.trcd-{}",
                crate::service::root_hash8(Path::new("/home/tester/.trc"))
            )
        );
        assert_ne!(label, agent_label(Path::new("/home/tester/.trc-other")));
        assert_eq!(
            plist_path(Path::new("/home/tester"), &label),
            Path::new("/home/tester/Library/LaunchAgents").join(format!("{label}.plist"))
        );
    }

    #[test]
    fn writes_a_plist_that_starts_the_core_at_login_and_after_a_crash_only() {
        let text = agent_plist(&spec());
        let label = agent_label(Path::new("/home/tester/.trc"));
        for expected in [
            format!("<key>Label</key>\n\t<string>{label}</string>"),
            "<array>\n\t\t<string>/home/tester/.trc/versions/abc/trcd</string>\n\t\t<string>core</string>\n\t\t<string>--launchd</string>\n\t</array>".to_owned(),
            "<key>HOME</key>\n\t\t<string>/home/tester</string>".to_owned(),
            "<key>SHELL</key>\n\t\t<string>/bin/zsh &amp; &lt;co&gt;</string>".to_owned(),
            "<key>RunAtLoad</key>\n\t<true/>".to_owned(),
            "<key>KeepAlive</key>\n\t<dict>\n\t\t<key>SuccessfulExit</key>\n\t\t<false/>\n\t</dict>".to_owned(),
            "<key>AbandonProcessGroup</key>\n\t<true/>".to_owned(),
            "<key>ThrottleInterval</key>\n\t<integer>1</integer>".to_owned(),
            "<key>ProcessType</key>\n\t<string>Interactive</string>".to_owned(),
            "<key>Umask</key>\n\t<integer>18</integer>".to_owned(),
            "<key>WorkingDirectory</key>\n\t<string>/</string>".to_owned(),
            "<key>StandardErrorPath</key>\n\t<string>/home/tester/.trc/logs/launchd.log</string>".to_owned(),
        ] {
            assert!(text.contains(&expected), "{expected:?} not in\n{text}");
        }
        assert!(text.starts_with("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE plist"));
        assert!(text.ends_with("</dict>\n</plist>\n"));
    }

    #[test]
    fn counts_an_agent_launchd_is_about_to_start_again_as_running() {
        let print = |state: &str| {
            format!("gui/501/dev.trc.trcd-1 = {{\n\tstate = {state}\n\tendpoints = {{\n\t\tstate = active\n\t}}\n}}\n")
        };
        assert!(starts_or_runs(&print("running")));
        assert!(starts_or_runs(&print("spawn scheduled")));
        assert!(!starts_or_runs(&print("not running")));
        assert!(!starts_or_runs("\t\tstate = running\n"));
    }

    #[test]
    fn bootstraps_a_new_agent_starts_a_loaded_one_and_replaces_a_changed_one() {
        assert_eq!(next_step(false, None, "a"), AgentStep::Bootstrap);
        assert_eq!(next_step(false, Some("old"), "a"), AgentStep::Bootstrap);
        assert_eq!(next_step(true, Some("a"), "a"), AgentStep::Kickstart);
        assert_eq!(next_step(true, Some("old"), "a"), AgentStep::Replace);
        assert_eq!(next_step(true, None, "a"), AgentStep::Replace);
    }
}
