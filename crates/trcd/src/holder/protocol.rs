//! Messages between the core and a holder, carried as `CONTROL` frames on the holder's socket. `OUTPUT`, `INPUT`
//! and `CREDIT` frames use [`SESSION_STREAM`].

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use trc_protocol::{ExitStatus, SessionState, ShellProfile, TerminalSize};

/// The stream that carries the session's output, input and credit on a holder socket.
pub const SESSION_STREAM: u32 = 1;

/// What a holder needs to start its session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HolderSpec {
    /// The resolved shell profile.
    pub profile: ShellProfile,
    /// The working directory; the home directory when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    /// The session's environment overrides, applied after the profile's.
    #[serde(default)]
    pub env: BTreeMap<String, Option<String>>,
    /// The initial PTY size.
    pub size: TerminalSize,
    /// The scrollback limit in lines.
    pub scrollback_lines: u32,
    /// The account's home directory.
    pub home: String,
    /// The account's user name.
    pub user: String,
}

/// A request from the core.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum HolderCommand {
    /// Starts the session. Sent once, on the first connection.
    Start {
        /// What to start.
        spec: Box<HolderSpec>,
    },
    /// Sends the screen snapshot and then live output, within the given credit.
    Attach {
        /// Output bytes the client may receive before it grants more.
        credit: u32,
    },
    /// Stops sending output.
    Detach,
    /// Resizes the PTY and the emulator.
    Resize {
        /// The new size.
        size: TerminalSize,
    },
    /// Stops the process with the SIGHUP, SIGTERM, SIGKILL sequence.
    Stop {
        /// Milliseconds between signals; the default when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        grace_ms: Option<u32>,
    },
    /// Stops the process if it runs, then starts the same shell again in the same terminal.
    Restart,
    /// Stops the process if it runs, then exits the holder.
    Shutdown,
    /// Remembers the user's name for the session, so a restarted core can recover it.
    Name {
        /// The name; absent clears it.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        name: Option<String>,
    },
}

/// What the holder reports about its session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HolderStatus {
    /// The lifecycle state.
    pub state: SessionState,
    /// The process ID while the process runs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    /// When the process started, in milliseconds since the Unix epoch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub started_at: Option<u64>,
    /// When the process last wrote output.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_output_at: Option<u64>,
    /// How the process ended.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exit: Option<ExitStatus>,
    /// Why the process failed to start.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure: Option<String>,
    /// The title the program set.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// The last known working directory.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    /// The PTY size.
    pub size: TerminalSize,
}

/// A message from the holder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum HolderEvent {
    /// Sent first on every connection, so a core can adopt a session it did not start.
    Hello {
        /// What the session runs; absent until `start`.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        spec: Option<Box<HolderSpec>>,
        /// The user's name for the session.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        name: Option<String>,
    },
    /// The session changed.
    Status {
        /// The session after the change.
        status: HolderStatus,
    },
    /// The holder is exiting after `shutdown`.
    Exiting,
}
