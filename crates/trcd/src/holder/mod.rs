//! `trcd holder`: one process per session that owns the PTY, the shell and the terminal emulator.

pub mod attachments;
pub mod environment;
pub mod osc7;
pub mod output_log;
pub mod persistence;
pub mod process;
pub mod protocol;
pub mod pty;
pub mod scrollback_file;
pub mod scrollback_writer;
pub mod service;
pub mod stop_plan;
