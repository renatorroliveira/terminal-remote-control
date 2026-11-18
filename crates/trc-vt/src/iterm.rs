//! iTerm2's OSC 1337, of which TRC reads three keys (OQ-6, P-69): `CurrentDir`, the working folder, `RemoteHost`,
//! which says where that folder is, and `SetMark`, a mark at the cursor's row. libghostty-vt reports `CurrentDir` as
//! its working directory, without saying where it is, and reads neither of the others, so the output is scanned for
//! them on its way to the terminal; every other key, `File=` among them, is ignored (SEC-06), and a sequence longer
//! than [`MAX_BODY`] is dropped. The scan also finds the end of each OSC 133 mark, after which the terminal takes the
//! mark's row before later output can move it.

use crate::sanitize::strip_controls;

/// The longest OSC body kept; a longer one is no key TRC reads.
const MAX_BODY: usize = 4096;

/// What an OSC 1337 sequence said.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ItermCommand {
    /// The working folder.
    CurrentDir(String),
    /// The `user@host` the folders that follow are on.
    RemoteHost(String),
    /// A mark at the cursor's row.
    SetMark,
    /// An OSC 133 mark ended here; libghostty-vt reads it.
    SemanticPrompt,
}

/// Finds OSC 1337 sequences in output that may split them across chunks.
#[derive(Debug, Default)]
pub(crate) struct ItermScanner {
    state: State,
    body: Vec<u8>,
    overflowed: bool,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
enum State {
    #[default]
    Ground,
    Escape,
    Osc,
    OscEscape,
}

impl ItermScanner {
    /// Each command in `bytes`, with the offset just after the sequence that carried it.
    pub(crate) fn scan(&mut self, bytes: &[u8]) -> Vec<(usize, ItermCommand)> {
        let mut found = Vec::new();
        for (index, byte) in bytes.iter().copied().enumerate() {
            if let Some(command) = self.step(byte) {
                found.push((index + 1, command));
            }
        }
        found
    }

    fn step(&mut self, byte: u8) -> Option<ItermCommand> {
        match (self.state, byte) {
            (State::Ground, 0x1b) | (State::Escape, 0x1b) => self.state = State::Escape,
            (State::Escape, b']') => self.open(),
            (State::Osc, 0x07) | (State::OscEscape, b'\\') => return self.close(),
            (State::Osc, 0x1b) => self.state = State::OscEscape,
            (State::Osc, 0x18 | 0x1a) | (State::Ground | State::Escape | State::OscEscape, _) => {
                self.state = State::Ground
            }
            (State::Osc, _) => self.keep(byte),
        }
        None
    }

    fn open(&mut self) {
        self.state = State::Osc;
        self.body.clear();
        self.overflowed = false;
    }

    fn keep(&mut self, byte: u8) {
        if self.body.len() < MAX_BODY {
            self.body.push(byte);
        } else {
            self.overflowed = true;
        }
    }

    fn close(&mut self) -> Option<ItermCommand> {
        self.state = State::Ground;
        if self.overflowed {
            return None;
        }
        command(&String::from_utf8_lossy(&self.body))
    }
}

fn command(body: &str) -> Option<ItermCommand> {
    if body.starts_with("133;") {
        return Some(ItermCommand::SemanticPrompt);
    }
    let rest = body.strip_prefix("1337;")?;
    if rest == "SetMark" {
        return Some(ItermCommand::SetMark);
    }
    let (key, value) = rest.split_once('=')?;
    let value = strip_controls(value);
    match key {
        "CurrentDir" if value.starts_with('/') => Some(ItermCommand::CurrentDir(value)),
        "RemoteHost" if !value.is_empty() => Some(ItermCommand::RemoteHost(value)),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn all(chunks: &[&[u8]]) -> Vec<ItermCommand> {
        let mut scanner = ItermScanner::default();
        chunks
            .iter()
            .flat_map(|chunk| scanner.scan(chunk).into_iter().map(|(_, command)| command))
            .collect()
    }

    #[test]
    fn reads_the_three_keys_with_either_terminator_and_split_across_chunks() {
        let commands = all(&[
            b"ls\r\n\x1b]1337;RemoteHost=me@devbox\x07\x1b]13",
            b"37;CurrentDir=/srv/my app\x1b\\",
            b"\x1b]1337;SetMark\x07",
        ]);
        assert_eq!(
            commands,
            [
                ItermCommand::RemoteHost("me@devbox".into()),
                ItermCommand::CurrentDir("/srv/my app".into()),
                ItermCommand::SetMark,
            ]
        );
    }

    #[test]
    fn says_where_each_sequence_ends() {
        let mut scanner = ItermScanner::default();
        assert_eq!(scanner.scan(b"a\x1b]1337;SetMark\x07b"), [(16, ItermCommand::SetMark)]);
    }

    #[test]
    fn ignores_every_other_key_other_oscs_overlong_ones_and_cancelled_ones_sec_06() {
        let overlong = format!("\x1b]1337;CurrentDir=/{}\x07", "x".repeat(MAX_BODY));
        let commands = all(&[
            b"\x1b]1337;File=name=eA==;inline=1:AAAA\x07",
            b"\x1b]1337;SetUserVar=x=eQ==\x07\x1b]7;file://h/tmp\x07\x1b]0;title\x07",
            overlong.as_bytes(),
            b"\x1b]1337;CurrentDir=/a\x18\x1b]1337;CurrentDir=relative\x07",
            b"\x1b]1337;CurrentDir=/ok\x07",
        ]);
        assert_eq!(commands, [ItermCommand::CurrentDir("/ok".into())]);
    }

    #[test]
    fn strips_control_characters_from_what_it_keeps() {
        assert_eq!(
            all(&[b"\x1b]1337;CurrentDir=/a\x01b\x07"]),
            [ItermCommand::CurrentDir("/ab".into())]
        );
    }
}
