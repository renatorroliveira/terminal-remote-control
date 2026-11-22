//! Command-line parsing for the fixed set of subcommands.

use std::path::PathBuf;

/// A `trcd` subcommand.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    /// The restartable supervisor.
    Core {
        /// Start the core in a new session and return at once, instead of running it in the foreground.
        detach: bool,
        /// The service manager that runs the core, if any.
        supervisor: Supervisor,
    },
    /// One session's PTY owner, serving the socket at `socket`.
    Holder {
        /// Where the holder binds its socket.
        socket: PathBuf,
    },
    /// Relays stdio to the core's socket.
    Bridge,
    /// Prints the version.
    Version,
    /// The app's `SSH_ASKPASS` helper on Windows (D-66), with the prompt ssh passes.
    Askpass {
        /// What ssh asks or notifies.
        prompt: String,
    },
    /// The app's `KnownHostsCommand` helper on Windows (D-66), with ssh's `%I %H %t %K %f`.
    KnownHosts {
        /// The tokens ssh expanded.
        args: Vec<String>,
    },
    /// Gives a folder a user-only ACL on Windows (D-68).
    PrivateDir {
        /// The folder.
        path: PathBuf,
    },
}

/// The status of a process SIGTERM ended, 128 plus the signal's number.
const EXIT_TERMINATED: u8 = 143;

/// The service manager a core runs under.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Supervisor {
    /// None: the core runs detached or in the foreground.
    None,
    /// A systemd user unit, so each holder starts in its own transient scope (D-44).
    Systemd,
    /// A launchd LaunchAgent, which starts the core at login and again after a crash (D-50).
    Launchd,
}

impl Supervisor {
    /// The exit status for a core refused for another running core or an untrusted install, which no retry fixes:
    /// under launchd a non-zero status would have `KeepAlive` start it again every second, so it exits with 0 (S8).
    pub fn refusal_status(self, status: u8) -> u8 {
        if self == Self::Launchd { 0 } else { status }
    }

    /// The exit status for a core that SIGTERM ended: 143 under launchd, so `KeepAlive` starts it again after a
    /// `kill`, Activity Monitor's Quit or `launchctl stop` (US-4.3.2), while a job launchd unloads, at a logout or a
    /// `bootout`, is never started again; 0 elsewhere, where the service manager or the next bridge starts it.
    pub fn terminated_status(self) -> u8 {
        if self == Self::Launchd { EXIT_TERMINATED } else { 0 }
    }
}

impl Command {
    /// The service manager a `core` runs under, and `None` for every other subcommand.
    pub fn supervisor(&self) -> Supervisor {
        match self {
            Self::Core { supervisor, .. } => *supervisor,
            _ => Supervisor::None,
        }
    }

    /// Parses the arguments after the program name.
    pub fn parse(args: &[String]) -> Result<Self, String> {
        match args.first().map(String::as_str) {
            Some("core") => Self::parse_core(&args[1..]),
            Some("holder") => Self::parse_holder(&args[1..]),
            Some("bridge") => Ok(Self::Bridge),
            Some("--version") => Ok(Self::Version),
            Some("askpass") => Ok(Self::Askpass {
                prompt: args.get(1).cloned().unwrap_or_default(),
            }),
            Some("known-hosts") => Ok(Self::KnownHosts {
                args: args[1..].to_vec(),
            }),
            Some("private-dir") => match &args[1..] {
                [path] => Ok(Self::PrivateDir { path: path.into() }),
                _ => Err("private-dir needs <folder>".into()),
            },
            Some(other) => Err(format!("unknown subcommand: {other}")),
            None => Err("missing subcommand: core, holder, bridge or --version".into()),
        }
    }

    fn parse_core(args: &[String]) -> Result<Self, String> {
        let core = |detach, supervisor| Ok(Self::Core { detach, supervisor });
        match args.first().map(String::as_str).filter(|_| args.len() == 1) {
            None if args.is_empty() => core(false, Supervisor::None),
            Some("--detach") => core(true, Supervisor::None),
            Some("--systemd") => core(false, Supervisor::Systemd),
            Some("--launchd") => core(false, Supervisor::Launchd),
            _ => Err("core takes only --detach, --systemd or --launchd".into()),
        }
    }

    fn parse_holder(args: &[String]) -> Result<Self, String> {
        match args {
            [flag, socket] if flag == "--socket" => Ok(Self::Holder { socket: socket.into() }),
            _ => Err("holder needs --socket <path>".into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(args: &[&str]) -> Result<Command, String> {
        Command::parse(&args.iter().map(|arg| (*arg).to_owned()).collect::<Vec<_>>())
    }

    #[test]
    fn parses_the_core_and_its_service_manager() {
        let core = |detach, supervisor| Ok(Command::Core { detach, supervisor });
        assert_eq!(parse(&["core"]), core(false, Supervisor::None));
        assert_eq!(parse(&["core", "--detach"]), core(true, Supervisor::None));
        assert_eq!(parse(&["core", "--systemd"]), core(false, Supervisor::Systemd));
        assert_eq!(parse(&["core", "--launchd"]), core(false, Supervisor::Launchd));
        assert_eq!(
            parse(&["core", "--now"]),
            Err("core takes only --detach, --systemd or --launchd".to_owned())
        );
    }

    #[test]
    fn parses_the_other_subcommands() {
        assert_eq!(
            parse(&["holder", "--socket", "/run/h.sock"]),
            Ok(Command::Holder {
                socket: "/run/h.sock".into()
            })
        );
        assert_eq!(parse(&["bridge"]), Ok(Command::Bridge));
        assert_eq!(
            parse(&["bridge"]).map(|command| command.supervisor()),
            Ok(Supervisor::None)
        );
        assert_eq!(
            parse(&["core", "--launchd"]).map(|command| command.supervisor()),
            Ok(Supervisor::Launchd)
        );
        assert_eq!(parse(&["--version"]), Ok(Command::Version));
    }

    #[test]
    fn parses_the_windows_helpers() {
        assert_eq!(
            parse(&["askpass", "Enter passphrase:"]),
            Ok(Command::Askpass {
                prompt: "Enter passphrase:".into()
            })
        );
        assert_eq!(parse(&["askpass"]), Ok(Command::Askpass { prompt: String::new() }));
        assert_eq!(
            parse(&["known-hosts", "ORDER", "h"]),
            Ok(Command::KnownHosts {
                args: vec!["ORDER".into(), "h".into()]
            })
        );
        assert_eq!(
            parse(&["private-dir", "C:/x"]),
            Ok(Command::PrivateDir { path: "C:/x".into() })
        );
        assert_eq!(parse(&["private-dir"]), Err("private-dir needs <folder>".to_owned()));
    }

    #[test]
    fn requires_the_holder_socket() {
        let missing = Err("holder needs --socket <path>".to_owned());
        assert_eq!(parse(&["holder"]), missing);
        assert_eq!(parse(&["holder", "--socket"]), missing);
        assert_eq!(parse(&["holder", "--port", "1"]), missing);
        assert_eq!(parse(&["holder", "--socket", "/a", "extra"]), missing);
    }

    #[test]
    fn rejects_unknown_and_missing_subcommands() {
        assert_eq!(parse(&["serve"]), Err("unknown subcommand: serve".to_owned()));
        assert_eq!(
            parse(&[]),
            Err("missing subcommand: core, holder, bridge or --version".to_owned())
        );
    }

    #[test]
    fn a_refused_core_under_launchd_exits_cleanly_so_launchd_does_not_loop() {
        assert_eq!(Supervisor::Launchd.refusal_status(75), 0);
        assert_eq!(Supervisor::Systemd.refusal_status(75), 75);
        assert_eq!(Supervisor::None.refusal_status(78), 78);
    }

    #[test]
    fn a_core_ended_by_sigterm_under_launchd_exits_so_launchd_starts_it_again() {
        assert_eq!(Supervisor::Launchd.terminated_status(), 143);
        assert_eq!(Supervisor::Systemd.terminated_status(), 0);
        assert_eq!(Supervisor::None.terminated_status(), 0);
    }
}
