//! Wire protocol between the desktop app and `trcd`: frame codec and control messages.

/// The protocol version this build speaks.
pub const PROTOCOL_VERSION: u32 = 1;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn speaks_protocol_version_one() {
        assert_eq!(PROTOCOL_VERSION, 1);
    }
}
