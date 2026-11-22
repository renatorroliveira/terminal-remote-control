//! `trcd`: the per-user daemon. One binary with the `core`, `holder` and `bridge` subcommands, and on Windows,
//! until the daemon runs there (US-6.2), the app's SSH helpers and its user-only folders (D-66, D-68).

#[cfg(unix)]
pub mod accept_backoff;
#[cfg(unix)]
pub mod bridge;
pub mod command;
#[cfg(unix)]
pub mod core;
pub mod digest;
#[cfg(unix)]
pub mod frame_io;
#[cfg(unix)]
pub mod holder;
#[cfg(unix)]
pub mod install;
#[cfg(unix)]
pub mod launchd;
#[cfg(unix)]
pub mod logging;
#[cfg(unix)]
pub mod peer;
#[cfg(unix)]
pub mod private_dir;
#[cfg(unix)]
pub mod run_dir;
#[cfg(unix)]
pub mod service;
#[cfg(unix)]
pub mod session_id;
#[cfg(unix)]
pub mod shell_integration;
#[cfg(unix)]
pub mod socket;
pub mod ssh_helper;
#[cfg(unix)]
pub mod time;
#[cfg(unix)]
pub mod upgrade;
#[cfg(windows)]
pub mod windows_acl;

#[cfg(test)]
mod test_support;
