//! A session's on-disk scrollback (TECH_STACK §5.5, NFR-08, SEC-05): one append-only file of records. Each record
//! holds the rows that left the screen since the record before and, when it changed, the primary screen at that
//! moment, so the records up to any point are consistent. On disk a record is `[u32 length][the first 4 bytes of
//! the payload's SHA-256][payload]`, and a payload is `[u8 flags][u32 history length][history][screen]`. Reading keeps
//! every record before the first that is cut short or fails its check: a crash loses only the write it interrupted.

use std::io::{self, Read};

use sha2::{Digest, Sha256};

/// The file's name in the session's data folder.
pub const FILE_NAME: &str = "scrollback.log";

/// The most a record may hold; a length above it marks the end of what can be trusted.
pub const MAX_RECORD: usize = 64 * 1024 * 1024;

const HEADER: usize = 8;
const HAS_SCREEN: u8 = 1;

/// One record: history rows and, when it changed, the screen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Record<'a> {
    /// Rows that left the screen, as VT output that continues the history before them.
    pub history: &'a [u8],
    /// The primary screen at the time of the record, when it changed since the last one.
    pub screen: Option<&'a [u8]>,
}

/// What reading a file kept.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Recovered {
    /// The last screen any kept record held.
    pub screen: Option<Vec<u8>>,
    /// The bytes the kept records take, where the next record goes.
    pub length: u64,
    /// The records kept.
    pub records: usize,
    /// Whether bytes after the kept records were dropped.
    pub truncated: bool,
}

/// Encodes a record as it is written.
pub fn encode(record: Record<'_>) -> Vec<u8> {
    let screen = record.screen.unwrap_or_default();
    let mut payload = Vec::with_capacity(5 + record.history.len() + screen.len());
    payload.push(if record.screen.is_some() { HAS_SCREEN } else { 0 });
    payload.extend_from_slice(&length_of(record.history).to_be_bytes());
    payload.extend_from_slice(record.history);
    payload.extend_from_slice(screen);
    let mut encoded = Vec::with_capacity(HEADER + payload.len());
    encoded.extend_from_slice(&length_of(&payload).to_be_bytes());
    encoded.extend_from_slice(&check_of(&payload));
    encoded.extend_from_slice(&payload);
    encoded
}

/// Reads every trustworthy record from `reader`, handing each one's history to `history` in order, and returns the
/// last screen they held and where the trusted part ends.
pub fn read(mut reader: impl Read, mut history: impl FnMut(&[u8])) -> io::Result<Recovered> {
    let mut recovered = Recovered::default();
    loop {
        let Some(payload) = next_payload(&mut reader, &mut recovered)? else {
            return Ok(recovered);
        };
        let Some((flags, past, screen)) = split(&payload) else {
            recovered.truncated = true;
            return Ok(recovered);
        };
        history(past);
        if flags & HAS_SCREEN != 0 {
            recovered.screen = Some(screen.to_vec());
        }
        recovered.records += 1;
        recovered.length += (HEADER + payload.len()) as u64;
    }
}

/// The next record's payload once its check passes; `None` at the end of the file or at the first record that is
/// cut short, too long or fails its check.
fn next_payload(reader: &mut impl Read, recovered: &mut Recovered) -> io::Result<Option<Vec<u8>>> {
    let mut header = [0u8; HEADER];
    match read_full(reader, &mut header)? {
        0 => return Ok(None),
        HEADER => {}
        _ => {
            recovered.truncated = true;
            return Ok(None);
        }
    }
    let [a, b, c, d, check @ ..] = header;
    let length = u32::from_be_bytes([a, b, c, d]) as usize;
    if length > MAX_RECORD {
        recovered.truncated = true;
        return Ok(None);
    }
    let mut payload = vec![0u8; length];
    if read_full(reader, &mut payload)? != length || check_of(&payload) != check {
        recovered.truncated = true;
        return Ok(None);
    }
    Ok(Some(payload))
}

fn split(payload: &[u8]) -> Option<(u8, &[u8], &[u8])> {
    let (&flags, rest) = payload.split_first()?;
    let (length, rest) = rest.split_first_chunk::<4>()?;
    let length = u32::from_be_bytes(*length) as usize;
    (length <= rest.len()).then(|| {
        let (history, screen) = rest.split_at(length);
        (flags, history, screen)
    })
}

/// Reads until `buffer` is full or the input ends, and returns how much it read.
fn read_full(reader: &mut impl Read, buffer: &mut [u8]) -> io::Result<usize> {
    let mut filled = 0;
    while filled < buffer.len() {
        match reader.read(&mut buffer[filled..]) {
            Ok(0) => break,
            Ok(read) => filled += read,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => return Err(error),
        }
    }
    Ok(filled)
}

fn check_of(payload: &[u8]) -> [u8; 4] {
    let digest = Sha256::digest(payload);
    [digest[0], digest[1], digest[2], digest[3]]
}

fn length_of(bytes: &[u8]) -> u32 {
    u32::try_from(bytes.len()).unwrap_or(u32::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn records() -> Vec<u8> {
        [
            encode(Record {
                history: b"one\r\n",
                screen: Some(b"screen 1"),
            }),
            encode(Record {
                history: b"two\r\n",
                screen: None,
            }),
            encode(Record {
                history: b"",
                screen: Some(b"screen 2"),
            }),
        ]
        .concat()
    }

    fn read_all(bytes: &[u8]) -> (Vec<u8>, Recovered) {
        let mut history = Vec::new();
        let recovered = read(bytes, |past| history.extend_from_slice(past)).unwrap();
        (history, recovered)
    }

    #[test]
    fn reads_back_the_history_in_order_and_the_last_screen() {
        let bytes = records();
        let (history, recovered) = read_all(&bytes);
        assert_eq!(history, b"one\r\ntwo\r\n");
        assert_eq!(recovered.screen.as_deref(), Some(&b"screen 2"[..]));
        assert_eq!(recovered.records, 3);
        assert_eq!(recovered.length, bytes.len() as u64);
        assert!(!recovered.truncated);
    }

    #[test]
    fn keeps_every_record_before_one_a_crash_cut_short_at_any_byte() {
        let bytes = records();
        let first = encode(Record {
            history: b"one\r\n",
            screen: Some(b"screen 1"),
        })
        .len();
        let second = first
            + encode(Record {
                history: b"two\r\n",
                screen: None,
            })
            .len();
        for cut in 0..bytes.len() {
            let (history, recovered) = read_all(&bytes[..cut]);
            let expected: (&[u8], usize, u64) = match cut {
                c if c < first => (b"", 0, 0),
                c if c < second => (b"one\r\n", 1, first as u64),
                _ => (b"one\r\ntwo\r\n", 2, second as u64),
            };
            assert_eq!(
                (&history[..], recovered.records, recovered.length),
                expected,
                "cut at {cut}"
            );
            assert_eq!(
                recovered.truncated,
                cut != 0 && cut != first && cut != second,
                "cut at {cut}"
            );
        }
    }

    #[test]
    fn stops_at_a_record_whose_check_fails() {
        let mut bytes = records();
        let second = encode(Record {
            history: b"one\r\n",
            screen: Some(b"screen 1"),
        })
        .len();
        bytes[second + HEADER + 2] ^= 0xff;
        let (history, recovered) = read_all(&bytes);
        assert_eq!(history, b"one\r\n");
        assert_eq!(recovered.screen.as_deref(), Some(&b"screen 1"[..]));
        assert!(recovered.truncated);
    }

    #[test]
    fn refuses_a_length_beyond_the_largest_record() {
        let mut bytes = (u32::try_from(MAX_RECORD).unwrap() + 1).to_be_bytes().to_vec();
        bytes.extend_from_slice(&[0; 12]);
        let (_, recovered) = read_all(&bytes);
        assert_eq!(recovered.records, 0);
        assert!(recovered.truncated);
    }
}
