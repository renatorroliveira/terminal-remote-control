//! SHA-256 of files, which identifies the running daemon binary (US-1.4.6).

use std::fmt::Write;
use std::io::{self, Read};
use std::path::Path;

use sha2::{Digest, Sha256};

/// The SHA-256 of the file at `path`, as lowercase hex.
pub fn sha256_file(path: &Path) -> io::Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .fold(String::with_capacity(64), |mut text, byte| {
            let _ = write!(text, "{byte:02x}");
            text
        }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_a_file() {
        let file = crate::test_support::temp_dir("digest").join("abc");
        std::fs::write(&file, b"abc").unwrap();
        assert_eq!(
            sha256_file(&file).unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
