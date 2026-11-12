//! `trcd holder`: one process per session that owns the PTY, the shell and the terminal emulator.

pub mod environment;
pub mod osc7;
pub mod output_gate;
pub mod process;
pub mod protocol;
pub mod pty;
pub mod service;
pub mod stop_plan;
