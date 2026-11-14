//! Command-line parsing for the fixed set of subcommands.

use std::path::PathBuf;

/// A `trcd` subcommand.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    /// The restartable supervisor.
    Core {
        /// Start the core in a new session and return at once, instead of running it in the foreground.
        detach: bool,
        /// The core runs as a systemd user unit, so each holder starts in its own transient scope (D-44).
        systemd: bool,
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

impl Command {
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
        let core = |detach, systemd| Ok(Self::Core { detach, systemd });
        match args {
            [] => core(false, false),
            [flag] if flag == "--detach" => core(true, false),
            [flag] if flag == "--systemd" => core(false, true),
            _ => Err("core takes only --detach or --systemd".into()),
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
    fn parses_each_subcommand() {
        assert_eq!(
            parse(&["core"]),
            Ok(Command::Core {
                detach: false,
                systemd: false
            })
        );
        assert_eq!(
            parse(&["core", "--detach"]),
            Ok(Command::Core {
                detach: true,
                systemd: false
            })
        );
        assert_eq!(
            parse(&["core", "--systemd"]),
            Ok(Command::Core {
                detach: false,
                systemd: true
            })
        );
        assert_eq!(
            parse(&["core", "--now"]),
            Err("core takes only --detach or --systemd".to_owned())
        );
        assert_eq!(
            parse(&["holder", "--socket", "/run/h.sock"]),
            Ok(Command::Holder {
                socket: "/run/h.sock".into()
            })
        );
        assert_eq!(parse(&["bridge"]), Ok(Command::Bridge));
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
}
