//! Safe terminal-state wrapper over libghostty-vt, behind the `TerminalState` trait.

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
