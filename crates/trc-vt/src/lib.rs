//! Terminal state for one session, behind the [`TerminalState`] trait, with libghostty-vt as the engine (D-02).

mod ghostty;
mod sanitize;

pub use ghostty::GhosttyTerminal;
pub use sanitize::strip_controls;
use thiserror::Error;

/// Terminal dimensions in cells.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TerminalSize {
    /// Width in cells.
    pub cols: u16,
    /// Height in cells.
    pub rows: u16,
}

impl TerminalSize {
    /// Creates a size, or `None` when either dimension is zero.
    pub fn new(cols: u16, rows: u16) -> Option<Self> {
        (cols > 0 && rows > 0).then_some(Self { cols, rows })
    }
}

/// An RGB color.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rgb(pub u8, pub u8, pub u8);

/// How a terminal is created.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalConfig {
    /// The initial size.
    pub size: TerminalSize,
    /// The scrollback limit in lines (NFR-10).
    pub scrollback_lines: usize,
    /// What XTVERSION reports, such as `trcd 0.1.0`.
    pub xtversion: String,
    /// The default foreground color reported to OSC 10 queries.
    pub foreground: Rgb,
    /// The default background color reported to OSC 11 queries.
    pub background: Rgb,
}

/// Something the terminal did while consuming output.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TerminalEvent {
    /// Bytes the terminal answers a query with; they go back to the PTY.
    Reply(Vec<u8>),
    /// The program set the title (OSC 0 or 2), stripped of control characters.
    Title(String),
    /// The program reported its working directory (OSC 7).
    WorkingDirectory(String),
    /// The program rang the bell.
    Bell,
}

/// A terminal operation failed.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum VtError {
    /// The engine could not allocate or refused a value; the number is its result code.
    #[error("terminal engine error {0}")]
    Engine(i32),
}

/// The authoritative screen and scrollback of one session.
pub trait TerminalState {
    /// Consumes program output and returns what the terminal did, in order.
    fn feed(&mut self, bytes: &[u8]) -> Vec<TerminalEvent>;
    /// Changes the size, reflowing soft-wrapped lines.
    fn resize(&mut self, size: TerminalSize) -> Result<(), VtError>;
    /// Encodes the screen and scrollback as VT sequences that recreate them in another terminal.
    fn snapshot(&self) -> Result<Vec<u8>, VtError>;
    /// Returns the screen and scrollback as plain text, one line per row.
    fn plain_text(&self) -> Result<String, VtError>;
    /// Returns the current size.
    fn size(&self) -> TerminalSize;
    /// Returns the cursor position as `(column, row)` on the screen, starting at 0.
    fn cursor(&self) -> (u16, u16);
    /// Returns whether the alternate screen is active.
    fn alternate_screen(&self) -> bool;
    /// Returns the number of rows in scrollback above the screen.
    fn scrollback_rows(&self) -> usize;
    /// Returns the title the program set, stripped of control characters.
    fn title(&self) -> Option<String>;
    /// Returns the working directory the program reported.
    fn working_directory(&self) -> Option<String>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_zero_dimensions() {
        assert_eq!(TerminalSize::new(0, 24), None);
        assert_eq!(TerminalSize::new(80, 0), None);
    }

    #[test]
    fn accepts_positive_dimensions() {
        assert_eq!(TerminalSize::new(80, 24), Some(TerminalSize { cols: 80, rows: 24 }));
    }
}
