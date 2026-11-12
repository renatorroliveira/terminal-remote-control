//! The account sessions run as: home directory, user name and login shell (TECH_STACK §8).
//!
//! sshd sets `HOME`, `USER` and `SHELL`; the passwd entry from `getent` fills gaps, because a static musl binary
//! cannot see NSS users such as LDAP.

use crate::holder::environment::Account;

/// The fields of a passwd entry the daemon uses.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PasswdEntry {
    /// The user name.
    pub name: String,
    /// The home directory.
    pub home: String,
    /// The login shell.
    pub shell: String,
}

/// Parses one `name:password:uid:gid:gecos:home:shell` line.
pub fn parse_passwd_line(line: &str) -> Option<PasswdEntry> {
    let fields: Vec<&str> = line.trim_end().split(':').collect();
    let [name, _, _, _, _, home, shell] = fields.as_slice() else {
        return None;
    };
    Some(PasswdEntry {
        name: (*name).to_owned(),
        home: (*home).to_owned(),
        shell: (*shell).to_owned(),
    })
}

/// Resolves the account from environment variables, asking `passwd` only for what they lack.
pub fn resolve_account(env: impl Fn(&str) -> Option<String>, passwd: impl FnOnce() -> Option<PasswdEntry>) -> Account {
    let home = env("HOME").filter(|value| is_absolute(value));
    let user = env("USER").or_else(|| env("LOGNAME")).filter(|value| !value.is_empty());
    let shell = env("SHELL").filter(|value| is_absolute(value));
    let entry = if home.is_some() && user.is_some() && shell.is_some() {
        None
    } else {
        passwd()
    };
    let from_entry = |field: fn(&PasswdEntry) -> &String| entry.as_ref().map(field).cloned();
    Account {
        home: home
            .or_else(|| from_entry(|e| &e.home).filter(|value| is_absolute(value)))
            .unwrap_or_else(|| "/".into()),
        user: user
            .or_else(|| from_entry(|e| &e.name))
            .unwrap_or_else(|| rustix::process::geteuid().as_raw().to_string()),
        shell: shell
            .or_else(|| from_entry(|e| &e.shell).filter(|value| is_absolute(value)))
            .unwrap_or_else(|| "/bin/sh".into()),
    }
}

/// The account of the running process.
pub fn current_account() -> Account {
    resolve_account(|name| std::env::var(name).ok(), getent_passwd)
}

fn is_absolute(path: &str) -> bool {
    path.starts_with('/')
}

fn getent_passwd() -> Option<PasswdEntry> {
    let uid = rustix::process::geteuid().as_raw().to_string();
    let output = std::process::Command::new("getent")
        .args(["passwd", &uid])
        .output()
        .ok()?;
    parse_passwd_line(String::from_utf8_lossy(&output.stdout).lines().next()?)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;

    fn entry() -> PasswdEntry {
        PasswdEntry {
            name: "ldapuser".into(),
            home: "/home/ldapuser".into(),
            shell: "/bin/zsh".into(),
        }
    }

    fn env(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let map: BTreeMap<String, String> = pairs.iter().map(|(k, v)| ((*k).to_owned(), (*v).to_owned())).collect();
        move |name| map.get(name).cloned()
    }

    #[test]
    fn parses_a_passwd_line() {
        assert_eq!(
            parse_passwd_line("ldapuser:*:2001:2001:LDAP User:/home/ldapuser:/bin/zsh"),
            Some(entry())
        );
        assert_eq!(parse_passwd_line("broken:line"), None);
    }

    #[test]
    fn prefers_the_environment_sshd_sets() {
        let account = resolve_account(
            env(&[("HOME", "/home/a"), ("USER", "a"), ("SHELL", "/bin/bash")]),
            || panic!("passwd is not needed"),
        );
        assert_eq!(
            account,
            Account {
                home: "/home/a".into(),
                user: "a".into(),
                shell: "/bin/bash".into()
            }
        );
    }

    #[test]
    fn falls_back_to_the_passwd_entry() {
        let account = resolve_account(env(&[("SHELL", "zsh")]), || Some(entry()));
        assert_eq!(
            account,
            Account {
                home: "/home/ldapuser".into(),
                user: "ldapuser".into(),
                shell: "/bin/zsh".into()
            }
        );
    }

    #[test]
    fn uses_logname_and_bin_sh_last() {
        let account = resolve_account(env(&[("HOME", "/h"), ("LOGNAME", "l")]), || None);
        assert_eq!(
            account,
            Account {
                home: "/h".into(),
                user: "l".into(),
                shell: "/bin/sh".into()
            }
        );
        let nothing = resolve_account(env(&[]), || None);
        assert_eq!(nothing.home, "/");
        assert_eq!(nothing.shell, "/bin/sh");
        assert_eq!(nothing.user, rustix::process::geteuid().as_raw().to_string());
    }
}
