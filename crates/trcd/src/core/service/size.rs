//! The terminal sizes the core accepts.

use trc_protocol::TerminalSize;

/// The most columns or rows of a terminal; grid memory grows with both, times the scrollback (NFR-09, NFR-10).
pub const MAX_DIMENSION: u16 = 1_000;

/// Why a requested terminal size is refused, or `None` when the core accepts it.
pub fn size_problem(size: TerminalSize) -> Option<&'static str> {
    if size.cols == 0 || size.rows == 0 {
        Some("the size must not be zero")
    } else if size.cols > MAX_DIMENSION || size.rows > MAX_DIMENSION {
        Some("the size must be at most 1000 columns and 1000 rows")
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_an_empty_or_an_oversized_terminal_and_accepts_the_rest() {
        let size = |cols, rows| TerminalSize { cols, rows };
        assert_eq!(size_problem(size(0, 24)), Some("the size must not be zero"));
        assert_eq!(size_problem(size(80, 0)), Some("the size must not be zero"));
        assert!(size_problem(size(1_001, 24)).is_some());
        assert!(size_problem(size(80, 1_001)).is_some());
        assert_eq!(size_problem(size(1_000, 1_000)), None);
        assert_eq!(size_problem(size(80, 24)), None);
    }
}
