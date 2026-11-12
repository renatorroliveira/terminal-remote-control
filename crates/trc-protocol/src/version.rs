//! Protocol version negotiation (NFR-12): each side speaks a range, the highest common version wins.

/// The newest protocol version this build speaks.
pub const PROTOCOL_VERSION: u32 = 1;
/// The oldest protocol version this build still speaks (N−1, never below 1).
pub const MIN_PROTOCOL_VERSION: u32 = 1;

/// Returns the highest version inside both inclusive ranges, or `None` when they do not overlap.
pub fn negotiate(local: (u32, u32), remote: (u32, u32)) -> Option<u32> {
    let highest = local.1.min(remote.1);
    (highest >= local.0.max(remote.0)).then_some(highest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_the_highest_common_version() {
        assert_eq!(negotiate((1, 2), (1, 3)), Some(2));
        assert_eq!(negotiate((2, 3), (1, 2)), Some(2));
        assert_eq!(negotiate((1, 1), (1, 1)), Some(1));
    }

    #[test]
    fn reports_disjoint_ranges() {
        assert_eq!(negotiate((1, 1), (2, 3)), None);
        assert_eq!(negotiate((3, 4), (1, 2)), None);
    }

    #[test]
    fn speaks_versions_n_and_n_minus_one() {
        assert_eq!(PROTOCOL_VERSION, 1);
        assert_eq!(MIN_PROTOCOL_VERSION, PROTOCOL_VERSION.saturating_sub(1).max(1));
    }
}
