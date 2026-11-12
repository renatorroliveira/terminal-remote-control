//! `trcd`: the per-user daemon. One binary with the `core`, `holder` and `bridge` subcommands.

mod command;

use command::Command;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match Command::parse(&args) {
        Ok(Command::Version) => println!("trcd {}", env!("CARGO_PKG_VERSION")),
        Ok(other) => {
            eprintln!("trcd: {other:?} is not implemented yet");
            std::process::exit(70);
        }
        Err(message) => {
            eprintln!("trcd: {message}");
            std::process::exit(64);
        }
    }
}
