//! `trcd` entry point.

use std::process::ExitCode;

use trcd::command::Command;
use trcd::ssh_helper::HelperOutcome;

/// Exit status for a malformed command line (`EX_USAGE`).
const EXIT_USAGE: u8 = 64;
/// Exit status when the operating system refuses a resource, such as a socket (`EX_OSERR`).
const EXIT_OS_ERROR: u8 = 71;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let command = match Command::parse(&args) {
        Ok(command) => command,
        Err(message) => return fail(EXIT_USAGE, &message),
    };
    match command {
        Command::Version => print_version(),
        Command::Askpass { prompt } => {
            let kind = std::env::var("SSH_ASKPASS_PROMPT").ok();
            report(trcd::ssh_helper::askpass(&prompt, kind.as_deref(), &nonce()))
        }
        Command::KnownHosts { args } => report(trcd::ssh_helper::known_hosts(&args, &nonce())),
        Command::PrivateDir { path } => platform::private_dir(&path),
        daemon => platform::run_daemon(daemon),
    }
}

/// The connection's nonce, which the app put in ssh's environment for its helpers.
fn nonce() -> String {
    std::env::var("TRC_SSH_NONCE").unwrap_or_default()
}

fn report(outcome: HelperOutcome) -> ExitCode {
    if let Some(line) = outcome.stderr {
        eprintln!("{line}");
    }
    ExitCode::from(outcome.status)
}

fn print_version() -> ExitCode {
    let checksum = std::env::current_exe().and_then(|binary| trcd::digest::sha256_file(&binary));
    match checksum {
        Ok(checksum) => {
            println!("trcd {} {checksum}", env!("CARGO_PKG_VERSION"));
            ExitCode::SUCCESS
        }
        Err(error) => fail(EXIT_OS_ERROR, &error.to_string()),
    }
}

fn fail(code: u8, message: &str) -> ExitCode {
    eprintln!("trcd: {message}");
    ExitCode::from(code)
}

#[cfg(unix)]
mod platform {
    use std::path::Path;
    use std::process::ExitCode;

    use trcd::command::Command;
    use trcd::core::process::{Ending, StartError};
    use trcd::install::InstallLayout;

    use super::{EXIT_OS_ERROR, EXIT_USAGE, fail};

    /// Exit status when another core already runs for this user (`EX_TEMPFAIL`).
    const EXIT_ALREADY_RUNNING: u8 = 75;
    /// Exit status when the install is not trustworthy (`EX_CONFIG`, SEC-04.4).
    const EXIT_UNTRUSTED_INSTALL: u8 = 78;

    /// Windows' ACLs have no Unix counterpart; the daemon sets modes itself.
    pub fn private_dir(_path: &Path) -> ExitCode {
        fail(EXIT_USAGE, "private-dir is for Windows")
    }

    /// Runs `core`, `holder` or `bridge` from a trusted install.
    pub fn run_daemon(command: Command) -> ExitCode {
        let refusal = |status| command.supervisor().refusal_status(status);
        let layout = match trusted_layout() {
            Ok(layout) => layout,
            Err(message) => return fail(refusal(EXIT_UNTRUSTED_INSTALL), &message),
        };
        match command {
            Command::Core {
                detach: false,
                supervisor,
            } => match trcd::core::process::run(&layout, supervisor) {
                Ok(Ending::Asked) => ExitCode::SUCCESS,
                Ok(Ending::Terminated) => ExitCode::from(supervisor.terminated_status()),
                Err(StartError::AlreadyRunning) => {
                    fail(refusal(EXIT_ALREADY_RUNNING), "another core is already running")
                }
                Err(error @ StartError::Io(_)) => {
                    let status = if error.may_pass() {
                        EXIT_OS_ERROR
                    } else {
                        refusal(EXIT_OS_ERROR)
                    };
                    fail(status, &error.to_string())
                }
            },
            Command::Core { detach: true, .. } => finish(trcd::core::process::launch_detached(&layout)),
            Command::Holder { socket } => finish(trcd::holder::process::serve(&socket)),
            Command::Bridge => finish(trcd::bridge::run(&layout)),
            _ => ExitCode::SUCCESS,
        }
    }

    fn trusted_layout() -> Result<InstallLayout, String> {
        let layout = InstallLayout::current().map_err(|error| error.to_string())?;
        layout
            .check_integrity(rustix::process::geteuid().as_raw())
            .map_err(|error| error.to_string())?;
        Ok(layout)
    }

    fn finish(result: std::io::Result<()>) -> ExitCode {
        match result {
            Ok(()) => ExitCode::SUCCESS,
            Err(error) => fail(EXIT_OS_ERROR, &error.to_string()),
        }
    }
}

#[cfg(windows)]
mod platform {
    use std::path::Path;
    use std::process::ExitCode;

    use trcd::command::Command;

    use super::{EXIT_OS_ERROR, EXIT_USAGE, fail};

    /// Gives `path` a user-only ACL and marks it not content indexed (D-68).
    pub fn private_dir(path: &Path) -> ExitCode {
        match trcd::windows_acl::make_private(path) {
            Ok(()) => ExitCode::SUCCESS,
            Err(error) => fail(EXIT_OS_ERROR, &format!("{}: {error}", path.display())),
        }
    }

    /// The daemon itself arrives on Windows with local sessions (US-6.2).
    pub fn run_daemon(_command: Command) -> ExitCode {
        fail(
            EXIT_USAGE,
            "the daemon does not run on Windows yet; only the SSH helpers do",
        )
    }
}
