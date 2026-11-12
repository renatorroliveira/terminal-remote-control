//! Shell profiles a host offers: the login shell first, then shells from `/etc/shells` and a PATH probe for bash,
//! zsh, fish and pwsh (US-1.7.2, TECH_STACK §8).

use std::path::{Path, PathBuf};

use trc_protocol::{Integration, ProfileOrigin, ShellKind, ShellProfile};

/// Programs some systems list in `/etc/shells` that are not interactive shells.
const NOT_SHELLS: [&str; 5] = ["tmux", "screen", "nologin", "false", "git-shell"];

/// The shells a host may offer, before deduplication.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellCandidates {
    /// The account's login shell.
    pub login: String,
    /// Entries of `/etc/shells`.
    pub listed: Vec<String>,
    /// bash, zsh, fish and pwsh found on PATH.
    pub on_path: Vec<String>,
}

/// The shell family a path names.
pub fn shell_kind(path: &str) -> ShellKind {
    match file_name(path) {
        "bash" => ShellKind::Bash,
        "zsh" => ShellKind::Zsh,
        "fish" => ShellKind::Fish,
        "pwsh" => ShellKind::Pwsh,
        "sh" | "dash" | "ash" | "ksh" | "mksh" => ShellKind::Sh,
        _ => ShellKind::Other,
    }
}

/// The absolute paths listed in an `/etc/shells` file.
pub fn parse_etc_shells(text: &str) -> Vec<String> {
    text.lines()
        .map(str::trim)
        .filter(|line| line.starts_with('/'))
        .map(str::to_owned)
        .collect()
}

/// Builds the profiles: the login shell, then every other executable candidate once. `resolve` returns a
/// candidate's canonical path when it is an executable file.
pub fn build_profiles(candidates: &ShellCandidates, resolve: impl Fn(&str) -> Option<PathBuf>) -> Vec<ShellProfile> {
    let login_name = file_name(&candidates.login);
    let mut profiles = vec![profile(
        "login".into(),
        format!("{login_name} (login shell)"),
        ProfileOrigin::Login,
        &candidates.login,
    )];
    let mut seen: Vec<PathBuf> = resolve(&candidates.login).into_iter().collect();
    let others = candidates
        .listed
        .iter()
        .chain(&candidates.on_path)
        .filter(|path| !NOT_SHELLS.contains(&file_name(path)));
    for path in others {
        let Some(canonical) = resolve(path).filter(|canonical| !seen.contains(canonical)) else {
            continue;
        };
        seen.push(canonical);
        profiles.push(detected(path, &profiles));
    }
    profiles
}

/// Detects this host's profiles for an account whose login shell is `login`.
pub fn detect_profiles(login: &str) -> Vec<ShellProfile> {
    let listed = std::fs::read_to_string("/etc/shells")
        .map(|text| parse_etc_shells(&text))
        .unwrap_or_default();
    let on_path = probe_path(&std::env::var("PATH").unwrap_or_default());
    build_profiles(
        &ShellCandidates {
            login: login.to_owned(),
            listed,
            on_path,
        },
        executable,
    )
}

fn detected(path: &str, existing: &[ShellProfile]) -> ShellProfile {
    let name = file_name(path);
    let short_id = format!("detected:{name}");
    if existing.iter().any(|profile| profile.id == short_id) {
        profile(
            format!("detected:{path}"),
            format!("{name} ({path})"),
            ProfileOrigin::Detected,
            path,
        )
    } else {
        profile(short_id, name.to_owned(), ProfileOrigin::Detected, path)
    }
}

fn profile(id: String, name: String, origin: ProfileOrigin, path: &str) -> ShellProfile {
    ShellProfile {
        id,
        name,
        origin,
        kind: shell_kind(path),
        path: path.to_owned(),
        args: Vec::new(),
        login: true,
        env: std::collections::BTreeMap::new(),
        cwd: None,
        integration: Integration::Auto,
    }
}

fn file_name(path: &str) -> &str {
    Path::new(path).file_name().and_then(|name| name.to_str()).unwrap_or("")
}

fn probe_path(path: &str) -> Vec<String> {
    ["bash", "zsh", "fish", "pwsh"]
        .iter()
        .filter_map(|name| {
            path.split(':')
                .filter(|dir| dir.starts_with('/'))
                .map(|dir| Path::new(dir).join(name))
                .find(|candidate| executable(&candidate.to_string_lossy()).is_some())
                .map(|found| found.to_string_lossy().into_owned())
        })
        .collect()
}

fn executable(path: &str) -> Option<PathBuf> {
    use std::os::unix::fs::PermissionsExt;
    let canonical = std::fs::canonicalize(path).ok()?;
    let metadata = std::fs::metadata(&canonical).ok()?;
    (metadata.is_file() && metadata.permissions().mode() & 0o111 != 0).then_some(canonical)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;

    fn resolver(table: &[(&str, &str)]) -> impl Fn(&str) -> Option<PathBuf> {
        let map: BTreeMap<String, PathBuf> = table
            .iter()
            .map(|(from, to)| ((*from).to_owned(), PathBuf::from(to)))
            .collect();
        move |path| map.get(path).cloned()
    }

    #[test]
    fn names_shell_kinds_by_file_name() {
        assert_eq!(shell_kind("/bin/bash"), ShellKind::Bash);
        assert_eq!(shell_kind("/usr/local/bin/zsh"), ShellKind::Zsh);
        assert_eq!(shell_kind("/usr/bin/fish"), ShellKind::Fish);
        assert_eq!(shell_kind("/opt/microsoft/powershell/7/pwsh"), ShellKind::Pwsh);
        assert_eq!(shell_kind("/bin/dash"), ShellKind::Sh);
        assert_eq!(shell_kind("/bin/ash"), ShellKind::Sh);
        assert_eq!(shell_kind("/bin/sh"), ShellKind::Sh);
        assert_eq!(shell_kind("/bin/tcsh"), ShellKind::Other);
    }

    #[test]
    fn parses_etc_shells() {
        let text = "# /etc/shells: valid login shells\n/bin/sh\n\n  /usr/bin/bash  \nrelative\n#/bin/zsh\n";
        assert_eq!(
            parse_etc_shells(text),
            vec!["/bin/sh".to_owned(), "/usr/bin/bash".to_owned()]
        );
    }

    #[test]
    fn lists_the_login_shell_first_and_every_other_shell_once() {
        let candidates = ShellCandidates {
            login: "/bin/bash".into(),
            listed: vec![
                "/bin/sh".into(),
                "/bin/bash".into(),
                "/usr/bin/bash".into(),
                "/usr/bin/tmux".into(),
            ],
            on_path: vec![
                "/usr/bin/zsh".into(),
                "/usr/bin/bash".into(),
                "/usr/local/bin/zsh".into(),
            ],
        };
        let resolve = resolver(&[
            ("/bin/bash", "/usr/bin/bash"),
            ("/usr/bin/bash", "/usr/bin/bash"),
            ("/bin/sh", "/usr/bin/dash"),
            ("/usr/bin/tmux", "/usr/bin/tmux"),
            ("/usr/bin/zsh", "/usr/bin/zsh"),
            ("/usr/local/bin/zsh", "/usr/local/bin/zsh"),
        ]);
        let profiles = build_profiles(&candidates, resolve);
        let summary: Vec<(&str, &str, &str)> = profiles
            .iter()
            .map(|p| (p.id.as_str(), p.name.as_str(), p.path.as_str()))
            .collect();
        assert_eq!(
            summary,
            vec![
                ("login", "bash (login shell)", "/bin/bash"),
                ("detected:sh", "sh", "/bin/sh"),
                ("detected:zsh", "zsh", "/usr/bin/zsh"),
                (
                    "detected:/usr/local/bin/zsh",
                    "zsh (/usr/local/bin/zsh)",
                    "/usr/local/bin/zsh"
                ),
            ]
        );
        assert_eq!(profiles[0].origin, ProfileOrigin::Login);
        assert_eq!(profiles[1].origin, ProfileOrigin::Detected);
        assert!(
            profiles
                .iter()
                .all(|p| p.login && p.args.is_empty() && p.integration == Integration::Auto)
        );
        assert_eq!(profiles[2].kind, ShellKind::Zsh);
    }

    #[test]
    fn skips_candidates_that_are_missing_or_not_executable() {
        let candidates = ShellCandidates {
            login: "/bin/sh".into(),
            listed: vec!["/bin/gone".into()],
            on_path: vec![],
        };
        let profiles = build_profiles(&candidates, resolver(&[("/bin/sh", "/bin/sh")]));
        assert_eq!(profiles.len(), 1);
    }

    #[test]
    fn detects_at_least_the_login_shell_on_this_host() {
        let profiles = detect_profiles("/bin/sh");
        assert_eq!(profiles[0].id, "login");
        assert_eq!(profiles[0].path, "/bin/sh");
    }
}
