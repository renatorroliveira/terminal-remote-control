//! `trcd` entry point.

use std::process::ExitCode;

use trcd::command::Command;
use trcd::core::process::StartError;
use trcd::install::InstallLayout;

/// Exit status for a malformed command line (`EX_USAGE`).
const EXIT_USAGE: u8 = 64;
/// Exit status when the operating system refuses a resource, such as a socket (`EX_OSERR`).
const EXIT_OS_ERROR: u8 = 71;
/// Exit status when another core already runs for this user (`EX_TEMPFAIL`).
const EXIT_ALREADY_RUNNING: u8 = 75;
/// Exit status when the install is not trustworthy (`EX_CONFIG`, SEC-04.4).
const EXIT_UNTRUSTED_INSTALL: u8 = 78;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let command = match Command::parse(&args) {
        Ok(command) => command,
        Err(message) => return fail(EXIT_USAGE, &message),
    };
    if command == Command::Version {
        return print_version();
    }
    let layout = match trusted_layout() {
        Ok(layout) => layout,
        Err(message) => return fail(EXIT_UNTRUSTED_INSTALL, &message),
    };
    match command {
        Command::Core { detach: false } => match trcd::core::process::run(&layout) {
            Ok(()) => ExitCode::SUCCESS,
            Err(StartError::AlreadyRunning) => fail(EXIT_ALREADY_RUNNING, "another core is already running"),
            Err(StartError::Io(error)) => fail(EXIT_OS_ERROR, &error.to_string()),
        },
        Command::Core { detach: true } => finish(trcd::core::process::launch_detached(&layout)),
        Command::Holder { socket } => finish(trcd::holder::process::serve(&socket)),
        Command::Bridge => finish(trcd::bridge::run(&layout)),
        Command::Version => ExitCode::SUCCESS,
    }
}

fn trusted_layout() -> Result<InstallLayout, String> {
    let layout = InstallLayout::current().map_err(|error| error.to_string())?;
    layout
        .check_integrity(rustix::process::geteuid().as_raw())
        .map_err(|error| error.to_string())?;
    Ok(layout)
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

fn finish(result: std::io::Result<()>) -> ExitCode {
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => fail(EXIT_OS_ERROR, &error.to_string()),
    }
}

fn fail(code: u8, message: &str) -> ExitCode {
    eprintln!("trcd: {message}");
    ExitCode::from(code)
}
