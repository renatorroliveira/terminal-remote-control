//! How a shell starts so that it reads TRC's script before its own startup files (P-73): bash 4 and later in POSIX
//! mode with `ENV`, which keeps a login shell one; bash 3.2, which ignores `ENV` once interactive, with `--rcfile`;
//! zsh with `ZDOTDIR`; fish with `XDG_DATA_DIRS`. Each script puts back what it borrowed before the user's files run.

use std::collections::BTreeMap;
use std::path::Path;

use trc_protocol::{ShellIntegration, ShellKind};

/// fish's data folders when `XDG_DATA_DIRS` is not set.
const FISH_DATA_DIRS: &str = "/usr/local/share:/usr/share";

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
        ShellKind::Bash if shell.bash_major.is_some_and(|major| major >= 4) => posix_bash(scripts, start),
        ShellKind::Bash if shell.bash_major.is_some() => rcfile_bash(scripts, start),
        ShellKind::Zsh => zsh(scripts, start),
        ShellKind::Fish => fish(scripts, start),
        _ => return (start, ShellIntegration::Unsupported),
    };
    (integrated, ShellIntegration::Injected)
}

/// The major version of the bash at `program`, from its `--version`; `None` when it does not answer as bash does.
pub fn probe_bash_major(program: &str) -> Option<u32> {
    let output = std::process::Command::new(program)
        .arg("--version")
        .env_clear()
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;
    bash_major(&String::from_utf8_lossy(&output.stdout))
}

/// The major version from bash's `--version` output, such as `GNU bash, version 5.2.21(1)-release`.
pub fn bash_major(version_output: &str) -> Option<u32> {
    let rest = version_output.lines().next()?.split("version ").nth(1)?;
    rest.split('.').next()?.parse().ok()
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
}
