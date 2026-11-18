//! How a shell starts so that it reads TRC's script before its own startup files (P-73): bash 4 and later in POSIX
//! mode with `ENV`, which keeps a login shell one; bash 3.2, which ignores `ENV` once interactive, with `--rcfile`;
//! zsh with `ZDOTDIR`; fish with `XDG_DATA_DIRS`. Each script puts back what it borrowed before the user's files run.

use std::collections::{BTreeMap, HashMap};
use std::io::Read;
use std::path::Path;
use std::process::Stdio;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use trc_protocol::{ShellIntegration, ShellKind};

/// fish's data folders when `XDG_DATA_DIRS` is not set.
const FISH_DATA_DIRS: &str = "/usr/local/share:/usr/share";
/// The longest `bash --version` may take.
const PROBE_TIMEOUT: Duration = Duration::from_secs(2);

/// A shell's start, before and after shell integration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellStart {
    /// The arguments after the program name.
    pub args: Vec<String>,
    /// Whether `argv[0]` makes it a login shell.
    pub login: bool,
    /// Its whole environment.
    pub env: BTreeMap<String, String>,
}

/// What shell integration needs to know about the shell.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Shell<'a> {
    /// Which shell it is.
    pub kind: ShellKind,
    /// For bash, its major version, which picks how it is started.
    pub bash_major: Option<u32>,
    /// The scripts' folder, when the core could write them.
    pub scripts: Option<&'a Path>,
}

/// Changes `start` so the shell reads TRC's script first, and says whether it does. A shell started with arguments of
/// its own is left alone, as they could change how it reads its startup files.
pub fn integrated(shell: Shell<'_>, start: ShellStart) -> (ShellStart, ShellIntegration) {
    let Some(scripts) = shell.scripts.filter(|_| start.args.is_empty()) else {
        return (start, ShellIntegration::Unsupported);
    };
    let integrated = match shell.kind {
        ShellKind::Bash if shell.bash_major.is_some_and(|major| major >= 4) && expands_as_is(scripts) => {
            posix_bash(scripts, start)
        }
        ShellKind::Bash if shell.bash_major.is_some() => rcfile_bash(scripts, start),
        ShellKind::Zsh => zsh(scripts, start),
        ShellKind::Fish => fish(scripts, start),
        _ => return (start, ShellIntegration::Unsupported),
    };
    (integrated, ShellIntegration::Injected)
}

/// The major version of the bash at `program`, from its `--version`; `None` when it does not answer as bash does.
pub fn probe_bash_major(program: &str) -> Option<u32> {
    static KNOWN: OnceLock<Mutex<HashMap<String, Option<u32>>>> = OnceLock::new();
    let known = KNOWN.get_or_init(Mutex::default);
    if let Some(major) = known.lock().ok().and_then(|known| known.get(program).copied()) {
        return major;
    }
    let major = run_version(program);
    if let Ok(mut known) = known.lock() {
        known.insert(program.to_owned(), major);
    }
    major
}

/// The major version from bash's `--version` output, such as `GNU bash, version 5.2.21(1)-release`.
pub fn bash_major(version_output: &str) -> Option<u32> {
    let rest = version_output.lines().next()?.split("version ").nth(1)?;
    rest.split('.').next()?.parse().ok()
}

/// Runs `program --version` for at most [`PROBE_TIMEOUT`], so a shell that hangs on it only goes without integration.
fn run_version(program: &str) -> Option<u32> {
    let mut child = std::process::Command::new(program)
        .arg("--version")
        .env_clear()
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let deadline = std::time::Instant::now() + PROBE_TIMEOUT;
    while child.try_wait().ok()?.is_none() {
        if std::time::Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    let mut output = String::new();
    child.stdout.take()?.read_to_string(&mut output).ok()?;
    bash_major(&output)
}

/// Whether bash reads `ENV`'s path as it is: bash expands `ENV`, so a `$`, a backquote or a backslash in the install
/// location would point it elsewhere and skip the user's startup files; such a location gets the `--rcfile` start.
fn expands_as_is(scripts: &Path) -> bool {
    !scripts.to_string_lossy().contains(['$', '`', '\\'])
}

fn posix_bash(scripts: &Path, mut start: ShellStart) -> ShellStart {
    start.args = vec!["--posix".into()];
    if let Some(own) = start.env.remove("ENV") {
        start.env.insert("TRC_BASH_ENV".into(), own);
    }
    start.env.insert("ENV".into(), script(scripts, "bash/trc.bash"));
    start.env.insert("TRC_BASH_INJECT".into(), "posix".into());
    with_folder(scripts, start)
}

fn rcfile_bash(scripts: &Path, mut start: ShellStart) -> ShellStart {
    start.args = vec!["--rcfile".into(), script(scripts, "bash/trc.bash")];
    if start.login {
        start.env.insert("TRC_BASH_LOGIN".into(), "1".into());
    }
    start.login = false;
    start.env.insert("TRC_BASH_INJECT".into(), "rcfile".into());
    with_folder(scripts, start)
}

fn zsh(scripts: &Path, mut start: ShellStart) -> ShellStart {
    if let Some(own) = start.env.remove("ZDOTDIR") {
        start.env.insert("TRC_ZSH_ZDOTDIR".into(), own);
    }
    start.env.insert("ZDOTDIR".into(), script(scripts, "zsh"));
    with_folder(scripts, start)
}

fn fish(scripts: &Path, mut start: ShellStart) -> ShellStart {
    let folder = scripts.to_string_lossy().into_owned();
    let own = start.env.remove("XDG_DATA_DIRS");
    if own.is_none() {
        start.env.insert("TRC_FISH_XDG_UNSET".into(), "1".into());
    }
    let rest = own.unwrap_or_else(|| FISH_DATA_DIRS.into());
    start.env.insert("XDG_DATA_DIRS".into(), format!("{folder}:{rest}"));
    start.env.insert("TRC_FISH_XDG_DIR".into(), folder);
    with_folder(scripts, start)
}

fn with_folder(scripts: &Path, mut start: ShellStart) -> ShellStart {
    start.env.insert(
        "TRC_SHELL_INTEGRATION_DIR".into(),
        scripts.to_string_lossy().into_owned(),
    );
    start
}

fn script(scripts: &Path, name: &str) -> String {
    scripts.join(name).to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCRIPTS: &str = "/home/tester/.trc/shell-integration/0123456789abcdef";

    fn start(login: bool, env: &[(&str, &str)]) -> ShellStart {
        ShellStart {
            args: vec![],
            login,
            env: env
                .iter()
                .map(|(key, value)| ((*key).into(), (*value).into()))
                .collect(),
        }
    }

    fn shell(kind: ShellKind, bash_major: Option<u32>) -> Shell<'static> {
        Shell {
            kind,
            bash_major,
            scripts: Some(Path::new(SCRIPTS)),
        }
    }

    fn value<'a>(start: &'a ShellStart, key: &str) -> Option<&'a str> {
        start.env.get(key).map(String::as_str)
    }

    #[test]
    fn starts_bash_4_in_posix_mode_with_env_keeping_a_login_shell_and_the_users_env() {
        let (started, state) = integrated(
            shell(ShellKind::Bash, Some(5)),
            start(true, &[("ENV", "/home/tester/.envrc")]),
        );
        assert_eq!(state, ShellIntegration::Injected);
        assert_eq!(started.args, ["--posix"]);
        assert!(started.login);
        assert_eq!(value(&started, "ENV"), Some(&*format!("{SCRIPTS}/bash/trc.bash")));
        assert_eq!(value(&started, "TRC_BASH_ENV"), Some("/home/tester/.envrc"));
        assert_eq!(value(&started, "TRC_BASH_INJECT"), Some("posix"));
        assert_eq!(value(&started, "TRC_SHELL_INTEGRATION_DIR"), Some(SCRIPTS));
    }

    #[test]
    fn starts_bash_3_with_an_rcfile_that_does_the_login_itself() {
        let (started, state) = integrated(shell(ShellKind::Bash, Some(3)), start(true, &[]));
        assert_eq!(state, ShellIntegration::Injected);
        assert_eq!(started.args, ["--rcfile", &*format!("{SCRIPTS}/bash/trc.bash")]);
        assert!(!started.login);
        assert_eq!(value(&started, "TRC_BASH_LOGIN"), Some("1"));
        assert_eq!(value(&started, "TRC_BASH_INJECT"), Some("rcfile"));
        let (non_login, _) = integrated(shell(ShellKind::Bash, Some(3)), start(false, &[]));
        assert_eq!(value(&non_login, "TRC_BASH_LOGIN"), None);
    }

    #[test]
    fn points_zsh_at_its_zshenv_and_keeps_the_users_zdotdir() {
        let (started, _) = integrated(
            shell(ShellKind::Zsh, None),
            start(true, &[("ZDOTDIR", "/home/tester/.zsh")]),
        );
        assert_eq!(value(&started, "ZDOTDIR"), Some(&*format!("{SCRIPTS}/zsh")));
        assert_eq!(value(&started, "TRC_ZSH_ZDOTDIR"), Some("/home/tester/.zsh"));
        assert!(started.login);
        assert!(started.args.is_empty());
        let (without, _) = integrated(shell(ShellKind::Zsh, None), start(true, &[]));
        assert_eq!(value(&without, "TRC_ZSH_ZDOTDIR"), None);
    }

    #[test]
    fn adds_its_folder_to_fishs_data_folders_and_says_when_there_were_none() {
        let (started, _) = integrated(shell(ShellKind::Fish, None), start(true, &[]));
        assert_eq!(
            value(&started, "XDG_DATA_DIRS"),
            Some(&*format!("{SCRIPTS}:/usr/local/share:/usr/share"))
        );
        assert_eq!(value(&started, "TRC_FISH_XDG_DIR"), Some(SCRIPTS));
        assert_eq!(value(&started, "TRC_FISH_XDG_UNSET"), Some("1"));
        let (kept, _) = integrated(
            shell(ShellKind::Fish, None),
            start(true, &[("XDG_DATA_DIRS", "/opt/share")]),
        );
        assert_eq!(value(&kept, "XDG_DATA_DIRS"), Some(&*format!("{SCRIPTS}:/opt/share")));
        assert_eq!(value(&kept, "TRC_FISH_XDG_UNSET"), None);
    }

    #[test]
    fn leaves_other_shells_shells_with_arguments_and_a_missing_folder_alone_us_5_2_3() {
        for (kind, major) in [(ShellKind::Sh, None), (ShellKind::Other, None), (ShellKind::Bash, None)] {
            let (started, state) = integrated(shell(kind, major), start(true, &[]));
            assert_eq!(state, ShellIntegration::Unsupported, "{kind:?}");
            assert_eq!(started, start(true, &[]));
        }
        let mut with_args = start(false, &[]);
        with_args.args = vec!["-c".into(), "make".into()];
        assert_eq!(
            integrated(shell(ShellKind::Zsh, None), with_args.clone()).1,
            ShellIntegration::Unsupported
        );
        let missing = Shell {
            scripts: None,
            ..shell(ShellKind::Zsh, None)
        };
        assert_eq!(integrated(missing, start(true, &[])).1, ShellIntegration::Unsupported);
    }

    #[test]
    fn reads_bashs_major_version() {
        assert_eq!(
            bash_major("GNU bash, version 5.2.21(1)-release (aarch64-unknown-linux-gnu)\nCopyright"),
            Some(5)
        );
        assert_eq!(
            bash_major("GNU bash, version 3.2.57(1)-release (arm64-apple-darwin25)"),
            Some(3)
        );
        assert_eq!(bash_major("not bash"), None);
    }

    #[test]
    fn gives_an_install_location_bash_would_expand_the_rcfile_start() {
        assert!(expands_as_is(Path::new(
            "/home/tester/.trc/shell-integration/0123456789abcdef"
        )));
        assert!(!expands_as_is(Path::new("/home/tester/$HOME/.trc")));
        assert!(!expands_as_is(Path::new("/home/tester/a`b`/.trc")));
        assert!(!expands_as_is(Path::new("/home/tester/a\\b/.trc")));
    }
}
