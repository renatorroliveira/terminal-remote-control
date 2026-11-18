//! Shell integration (US-5.1, D-55, P-73): TRC's own scripts, embedded in `trcd`, written by the core into the
//! install root, and read first by each shell the holder starts, so its prompts and commands are marked with OSC 133
//! and its working folder reported with OSC 7, while the user's startup files stay as they are.

pub mod install;
pub mod start;
