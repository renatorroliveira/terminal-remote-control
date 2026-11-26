//! `uia-probe`: prints, as JSON, what Windows UI Automation reports for an app (PRD §11.2, D-69), as `ax-probe` does
//! with macOS's AX API. `focused <pid> <timeout-ms>` waits until the focused element belongs to `pid` and reports its
//! control type, name, keyboard focus, text and the bounds of its selection and caret (A11Y-01, A11Y-04, A11Y-06);
//! `at <x> <y>` reports the line of text under a screen point, which Magnifier's read aloud starts from (A11Y-06.5);
//! `foreground <pid>` brings the process's window to the foreground, which a test's app can't take by itself.
//! Exit status 0 on success, 1 when nothing could be read, 64 for a malformed command line.

#[cfg(windows)]
mod foreground;
#[cfg(windows)]
mod json;
#[cfg(windows)]
mod probe;

/// Exit status for a malformed command line (`EX_USAGE`).
const EXIT_USAGE: u8 = 64;

fn main() -> std::process::ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    run(&args)
}

#[cfg(windows)]
fn run(args: &[String]) -> std::process::ExitCode {
    let report = match args {
        [command, pid, timeout] if command == "focused" => match (pid.parse(), timeout.parse()) {
            (Ok(pid), Ok(timeout)) => probe::focused(pid, std::time::Duration::from_millis(timeout)),
            _ => return usage(),
        },
        [command, x, y] if command == "at" => match (x.parse(), y.parse()) {
            (Ok(x), Ok(y)) => probe::at(x, y),
            _ => return usage(),
        },
        [command, pid] if command == "foreground" => match pid.parse() {
            Ok(pid) => foreground::foreground(pid),
            Err(_) => return usage(),
        },
        _ => return usage(),
    };
    println!("{}", report.text);
    std::process::ExitCode::from(if report.ok { 0 } else { 1 })
}

#[cfg(not(windows))]
fn run(_args: &[String]) -> std::process::ExitCode {
    eprintln!("uia-probe: UI Automation exists only on Windows");
    std::process::ExitCode::from(EXIT_USAGE)
}

#[cfg(windows)]
fn usage() -> std::process::ExitCode {
    eprintln!("usage: uia-probe focused <pid> <timeout-ms> | uia-probe at <x> <y> | uia-probe foreground <pid>");
    std::process::ExitCode::from(EXIT_USAGE)
}
