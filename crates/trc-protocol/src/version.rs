//! Protocol version negotiation (NFR-12): each side speaks a range, the highest common version wins.

/// The newest protocol version this build speaks.
pub const PROTOCOL_VERSION: u32 = 4;
/// The oldest protocol version this build still speaks: at most N−1 (NFR-12), and 1 so far, for apps from 0.2.0
/// on (P-49).
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

    const _: () = assert!(MIN_PROTOCOL_VERSION < PROTOCOL_VERSION, "N−1 must stay spoken (NFR-12)");

    #[test]
    fn speaks_versions_one_to_three() {
        assert_eq!((MIN_PROTOCOL_VERSION, PROTOCOL_VERSION), (1, 4));
    }
}
