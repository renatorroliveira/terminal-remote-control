//! The environment a session's shell starts with (TECH_STACK §8). Nothing is inherited from the daemon, whose
//! environment carries stale `SSH_*` values from whichever connection started it.

use std::collections::BTreeMap;

/// The account facts the environment is built from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Account {
    /// The home directory.
    pub home: String,
    /// The user name.
    pub user: String,
    /// The shell the session runs.
    pub shell: String,
}

/// `PATH` until the login shell's startup files set their own.
pub const DEFAULT_PATH: &str = "/usr/local/bin:/usr/bin:/bin";
/// `LANG` until the user's startup files or overrides set their own, so the shell starts in UTF-8.
pub const DEFAULT_LANG: &str = "C.UTF-8";

/// Builds the environment: fixed terminal variables, the account variables, then the profile's overrides and the
/// session's overrides in that order. A `None` override removes the variable.
pub fn session_environment(
    account: &Account,
    version: &str,
    overrides: &[&BTreeMap<String, Option<String>>],
) -> BTreeMap<String, String> {
    let mut env: BTreeMap<String, String> = [
        ("TERM", "xterm-256color"),
        ("COLORTERM", "truecolor"),
        ("TERM_PROGRAM", "trc"),
        ("TERM_PROGRAM_VERSION", version),
        ("HOME", &account.home),
        ("USER", &account.user),
        ("LOGNAME", &account.user),
        ("SHELL", &account.shell),
        ("PATH", DEFAULT_PATH),
        ("LANG", DEFAULT_LANG),
    ]
    .into_iter()
    .map(|(key, value)| (key.to_owned(), value.to_owned()))
    .collect();
    for (key, value) in overrides.iter().flat_map(|layer| layer.iter()) {
        match value {
            Some(value) => env.insert(key.clone(), value.clone()),
            None => env.remove(key),
        };
    }
    env
}

#[cfg(test)]
mod tests {
    use super::*;

    fn account() -> Account {
        Account {
            home: "/home/tester".into(),
            user: "tester".into(),
            shell: "/bin/bash".into(),
        }
    }

    fn pairs(env: &BTreeMap<String, String>) -> Vec<(&str, &str)> {
        env.iter().map(|(key, value)| (key.as_str(), value.as_str())).collect()
    }

    #[test]
    fn sets_terminal_and_account_variables_only() {
        let env = session_environment(&account(), "0.1.0", &[]);
        assert_eq!(
            pairs(&env),
            [
                ("COLORTERM", "truecolor"),
                ("HOME", "/home/tester"),
                ("LANG", DEFAULT_LANG),
                ("LOGNAME", "tester"),
                ("PATH", DEFAULT_PATH),
                ("SHELL", "/bin/bash"),
                ("TERM", "xterm-256color"),
                ("TERM_PROGRAM", "trc"),
                ("TERM_PROGRAM_VERSION", "0.1.0"),
                ("USER", "tester"),
            ]
        );
    }

    #[test]
    fn applies_profile_then_session_overrides_and_removes_unset_variables() {
        let profile = BTreeMap::from([
            ("EDITOR".into(), Some("vi".into())),
            ("LANG".into(), Some("de_DE.UTF-8".into())),
        ]);
        let session = BTreeMap::from([("EDITOR".into(), Some("vim".into())), ("COLORTERM".into(), None)]);
        let env = session_environment(&account(), "0.1.0", &[&profile, &session]);
        assert_eq!(env.get("EDITOR").map(String::as_str), Some("vim"));
        assert_eq!(env.get("LANG").map(String::as_str), Some("de_DE.UTF-8"));
        assert!(!env.contains_key("COLORTERM"));
    }
}
