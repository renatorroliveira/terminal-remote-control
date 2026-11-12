//! Session state as the daemon reports it (US-1.9).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::profile::ShellProfile;

/// A session's identifier, unique on its host.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SessionId(pub String);

/// Terminal dimensions in cells.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TerminalSize {
    /// Width in cells.
    pub cols: u16,
    /// Height in cells.
    pub rows: u16,
}

/// The lifecycle state the daemon owns. `Disconnected` is the app's view of a lost connection, not a daemon state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum SessionState {
    /// The PTY and process are being created.
    Starting,
    /// The process runs.
    Running,
    /// The process ended on its own; see the exit status.
    Exited,
    /// The user stopped the process.
    Stopped,
    /// The process could not start; see the failure reason.
    FailedToStart,
    /// A state this version does not know.
    #[serde(other)]
    Unspecified,
}

/// How a session's process ended.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ExitStatus {
    /// The exit code, when the process exited normally.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub code: Option<i32>,
    /// The signal name, when a signal ended the process.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub signal: Option<String>,
}

/// Everything the app shows about a session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SessionInfo {
    /// The session's identifier.
    pub id: SessionId,
    /// The name the user gave the session, which wins over the program title (US-1.10.1).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub custom_name: Option<String>,
    /// The title the program set with OSC 0 or 2, stripped of control characters.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub title: Option<String>,
    /// The position in the host's user-defined order, starting at 0.
    pub order: u32,
    /// The lifecycle state.
    pub state: SessionState,
    /// The resolved shell profile the session runs.
    pub profile: ShellProfile,
    /// The last known working directory.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cwd: Option<String>,
    /// The PTY size.
    pub size: TerminalSize,
    /// The process ID while the process runs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub pid: Option<u32>,
    /// When the process started, in milliseconds since the Unix epoch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub started_at: Option<u64>,
    /// When the process last wrote output, in milliseconds since the Unix epoch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub last_output_at: Option<u64>,
    /// How the process ended.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub exit: Option<ExitStatus>,
    /// Why the process failed to start.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub failure: Option<String>,
}
