//! `trcd`: the per-user daemon. One binary with the `core`, `holder` and `bridge` subcommands.

pub mod accept_backoff;
pub mod bridge;
pub mod command;
pub mod core;
pub mod digest;
pub mod frame_io;
pub mod holder;
pub mod install;
pub mod logging;
pub mod peer;
pub mod private_dir;
pub mod run_dir;
pub mod session_id;
pub mod socket;
pub mod time;

#[cfg(test)]
mod test_support;
