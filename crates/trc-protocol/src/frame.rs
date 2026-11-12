//! Length-prefixed frames: `u32 length (big-endian) | u8 kind | u32 stream | payload`.
//!
//! The length counts the kind, stream and payload bytes. Routers read the 9-byte header without parsing payloads.

use thiserror::Error;

/// Bytes in the frame header: length, kind and stream.
pub const HEADER_LEN: usize = 9;
/// The largest payload a frame may carry.
pub const MAX_PAYLOAD: usize = 1024 * 1024;
/// The largest payload an `OUTPUT` frame carries; larger output is split.
pub const MAX_OUTPUT_CHUNK: usize = 32 * 1024;
/// The output credit an attached stream starts with, and the most it may hold (D-19).
pub const CREDIT_WINDOW: u32 = 256 * 1024;
/// The stream that carries control messages.
pub const CONTROL_STREAM: u32 = 0;

/// What a frame carries.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameKind {
    /// One JSON control message, on stream 0.
    Control,
    /// Raw PTY output.
    Output,
    /// Raw input bytes.
    Input,
    /// A big-endian `u32` count of bytes granted to the sender.
    Credit,
    /// A kind this version does not know; receivers ignore it.
    Unknown(u8),
}

impl FrameKind {
    /// Returns the wire value of the kind.
    pub fn to_byte(self) -> u8 {
        match self {
            Self::Control => 0,
            Self::Output => 1,
            Self::Input => 2,
            Self::Credit => 3,
            Self::Unknown(byte) => byte,
        }
    }

    /// Reads a kind from its wire value.
    pub fn from_byte(byte: u8) -> Self {
        match byte {
            0 => Self::Control,
            1 => Self::Output,
            2 => Self::Input,
            3 => Self::Credit,
            other => Self::Unknown(other),
        }
    }
}

/// One decoded frame.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frame {
    /// What the payload is.
    pub kind: FrameKind,
    /// The stream the frame belongs to.
    pub stream: u32,
    /// The payload bytes.
    pub payload: Vec<u8>,
}

/// A frame that cannot be decoded or encoded.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum FrameError {
    /// The length field is smaller than the kind and stream fields.
    #[error("frame length {0} is shorter than its header")]
    TooShort(u32),
    /// The payload exceeds [`MAX_PAYLOAD`].
    #[error("frame payload of {0} bytes exceeds the {MAX_PAYLOAD}-byte limit")]
    TooLarge(usize),
}

/// Encodes one frame.
pub fn encode(kind: FrameKind, stream: u32, payload: &[u8]) -> Result<Vec<u8>, FrameError> {
    if payload.len() > MAX_PAYLOAD {
        return Err(FrameError::TooLarge(payload.len()));
    }
    let length = u32::try_from(payload.len() + HEADER_LEN - 4).map_err(|_| FrameError::TooLarge(payload.len()))?;
    let mut bytes = Vec::with_capacity(HEADER_LEN + payload.len());
    bytes.extend_from_slice(&length.to_be_bytes());
    bytes.push(kind.to_byte());
    bytes.extend_from_slice(&stream.to_be_bytes());
    bytes.extend_from_slice(payload);
    Ok(bytes)
}

/// Encodes a `CREDIT` frame granting `bytes` on `stream`.
pub fn encode_credit(stream: u32, bytes: u32) -> Vec<u8> {
    let mut frame = Vec::with_capacity(HEADER_LEN + 4);
    frame.extend_from_slice(&9u32.to_be_bytes());
    frame.push(FrameKind::Credit.to_byte());
    frame.extend_from_slice(&stream.to_be_bytes());
    frame.extend_from_slice(&bytes.to_be_bytes());
    frame
}

/// Incremental decoder: feed it bytes as they arrive and take whole frames out.
#[derive(Debug, Default)]
pub struct FrameDecoder {
    buffer: Vec<u8>,
}

impl FrameDecoder {
    /// Creates an empty decoder.
    pub fn new() -> Self {
        Self::default()
    }

    /// Appends received bytes.
    pub fn push(&mut self, bytes: &[u8]) {
        self.buffer.extend_from_slice(bytes);
    }

    /// Returns the next whole frame, `Ok(None)` when more bytes are needed, or an error for a malformed frame.
    pub fn next_frame(&mut self) -> Result<Option<Frame>, FrameError> {
        let Some(length) = self.buffer.first_chunk::<4>().map(|bytes| u32::from_be_bytes(*bytes)) else {
            return Ok(None);
        };
        let body = usize::try_from(length).map_err(|_| FrameError::TooLarge(usize::MAX))?;
        let payload_len = body.checked_sub(HEADER_LEN - 4).ok_or(FrameError::TooShort(length))?;
        if payload_len > MAX_PAYLOAD {
            return Err(FrameError::TooLarge(payload_len));
        }
        if self.buffer.len() < 4 + body {
            return Ok(None);
        }
        let frame = Frame {
            kind: FrameKind::from_byte(self.buffer[4]),
            stream: u32::from_be_bytes([self.buffer[5], self.buffer[6], self.buffer[7], self.buffer[8]]),
            payload: self.buffer[HEADER_LEN..4 + body].to_vec(),
        };
        self.buffer.drain(..4 + body);
        Ok(Some(frame))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinds_round_trip_through_their_wire_values() {
        for (kind, byte) in [
            (FrameKind::Control, 0),
            (FrameKind::Output, 1),
            (FrameKind::Input, 2),
            (FrameKind::Credit, 3),
            (FrameKind::Unknown(9), 9),
        ] {
            assert_eq!(kind.to_byte(), byte);
            assert_eq!(FrameKind::from_byte(byte), kind);
        }
    }

    #[test]
    fn encodes_the_header_big_endian() {
        let bytes = encode(FrameKind::Output, 7, b"hi").unwrap();
        assert_eq!(bytes, [0, 0, 0, 7, 1, 0, 0, 0, 7, b'h', b'i']);
    }

    #[test]
    fn encodes_credit_as_a_u32_payload() {
        assert_eq!(encode_credit(3, 65536), [0, 0, 0, 9, 3, 0, 0, 0, 3, 0, 1, 0, 0]);
    }

    #[test]
    fn refuses_to_encode_oversized_payloads() {
        let payload = vec![0; MAX_PAYLOAD + 1];
        assert_eq!(
            encode(FrameKind::Control, 0, &payload),
            Err(FrameError::TooLarge(MAX_PAYLOAD + 1))
        );
    }

    #[test]
    fn decodes_frames_split_across_reads() {
        let mut wire = encode(FrameKind::Control, 0, b"{}").unwrap();
        wire.extend(encode(FrameKind::Input, 2, b"\x03").unwrap());
        let mut decoder = FrameDecoder::new();
        let mut frames = Vec::new();
        for byte in wire {
            decoder.push(&[byte]);
            while let Some(frame) = decoder.next_frame().unwrap() {
                frames.push(frame);
            }
        }
        assert_eq!(
            frames,
            [
                Frame {
                    kind: FrameKind::Control,
                    stream: 0,
                    payload: b"{}".to_vec()
                },
                Frame {
                    kind: FrameKind::Input,
                    stream: 2,
                    payload: vec![3]
                },
            ]
        );
    }

    #[test]
    fn rejects_lengths_shorter_than_the_header_and_oversized_frames() {
        let mut decoder = FrameDecoder::new();
        decoder.push(&[0, 0, 0, 4, 0, 0, 0, 0]);
        assert_eq!(decoder.next_frame(), Err(FrameError::TooShort(4)));

        let mut decoder = FrameDecoder::new();
        let too_large = u32::try_from(MAX_PAYLOAD + 6).unwrap().to_be_bytes();
        decoder.push(&too_large);
        assert_eq!(decoder.next_frame(), Err(FrameError::TooLarge(MAX_PAYLOAD + 1)));
    }
}
