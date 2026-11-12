//! Session identifiers: 16 lowercase hex digits from the OS random source, also used as holder socket names.

use std::fmt::Write;
use std::io::{self, Read};

use trc_protocol::SessionId;

/// The length of every session identifier.
pub const SESSION_ID_LEN: usize = 16;

/// Creates a new random session identifier.
pub fn new_session_id() -> io::Result<SessionId> {
    let mut bytes = [0_u8; SESSION_ID_LEN / 2];
    std::fs::File::open("/dev/urandom")?.read_exact(&mut bytes)?;
    let text = bytes
        .iter()
        .fold(String::with_capacity(SESSION_ID_LEN), |mut text, byte| {
            let _ = write!(text, "{byte:02x}");
            text
        });
    Ok(SessionId(text))
}

/// Whether `text` has the shape of a session identifier, so it is safe to use in a file name.
pub fn is_session_id(text: &str) -> bool {
    text.len() == SESSION_ID_LEN && text.bytes().all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_distinct_well_formed_identifiers() {
        let first = new_session_id().unwrap();
        let second = new_session_id().unwrap();
        assert_ne!(first, second);
        assert!(is_session_id(&first.0), "{first:?}");
        assert_eq!(first.0.len(), SESSION_ID_LEN);
    }

    #[test]
    fn accepts_only_sixteen_lowercase_hex_digits() {
        assert!(is_session_id("0123456789abcdef"));
        assert!(!is_session_id("0123456789ABCDEF"));
        assert!(!is_session_id("0123456789abcde"));
        assert!(!is_session_id("../../etc/passwd"));
        assert!(!is_session_id(""));
    }
}
