//! `trcd`: the per-user daemon. One binary with the `core`, `holder` and `bridge` subcommands.

pub mod command;
pub mod frame_io;
pub mod holder;
pub mod peer;
pub mod time;
