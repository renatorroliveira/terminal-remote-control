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
}

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
    /// The exit status for a core that may not start, such as one refused for another running core: under launchd a
    /// non-zero status would have `KeepAlive` start it again every 10 s, so it exits with 0 (S8).
    pub fn refusal_status(self, status: u8) -> u8 {
        if self == Self::Launchd { 0 } else { status }
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
}
