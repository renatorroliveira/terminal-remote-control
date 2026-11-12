//! `trcd` entry point.

use trcd::command::Command;

/// Exit status for a malformed command line (`EX_USAGE`).
const EXIT_USAGE: i32 = 64;
/// Exit status for a subcommand that is not available yet (`EX_SOFTWARE`).
const EXIT_UNAVAILABLE: i32 = 70;
/// Exit status when the operating system refuses a resource, such as the socket (`EX_OSERR`).
const EXIT_OS_ERROR: i32 = 71;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match Command::parse(&args) {
        Ok(Command::Version) => println!("trcd {}", env!("CARGO_PKG_VERSION")),
        Ok(Command::Holder { socket }) => {
            if let Err(error) = trcd::holder::process::serve(&socket) {
                eprintln!("trcd holder: {error}");
                std::process::exit(EXIT_OS_ERROR);
            }
        }
        Ok(other) => {
            eprintln!("trcd: {other:?} is not implemented yet");
            std::process::exit(EXIT_UNAVAILABLE);
        }
        Err(message) => {
            eprintln!("trcd: {message}");
            std::process::exit(EXIT_USAGE);
        }
    }
}
