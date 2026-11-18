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
    /// Why the processes ended with no exit status of their own, for a session not restored (P-41, protocol 3).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub ended: Option<EndCause>,
}

/// What ended a session's processes from outside the session (P-41).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum EndCause {
    /// The host restarted.
    HostRestart,
    /// They ended while the host kept running: a logout that ends user processes, or a killed holder.
    ProcessesEnded,
    /// A cause this version does not know.
    #[serde(other)]
    Unspecified,
}

/// What survives a session's processes ending without the user stopping them (US-3.2, protocol 3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SessionOptions {
    /// Whether the session comes back in a new shell (US-3.2.1).
    pub restore: bool,
    /// Whether its scrollback and screen are saved to disk (US-3.2.2, SEC-05).
    pub save_scrollback: bool,
    /// Whether its shell starts with TRC's shell integration (US-5.1.3, protocol 4); absent means on, as older apps
    /// and daemons know nothing of it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub integration: Option<bool>,
}

impl SessionOptions {
    /// Whether the shell starts with TRC's shell integration: unless it was turned off.
    pub fn integration_on(&self) -> bool {
        self.integration != Some(false)
    }
}

impl Default for SessionOptions {
    /// Restore and saving on, as US-3.2 has them by default, and shell integration on (US-5.1.1).
    fn default() -> Self {
        Self {
            restore: true,
            save_scrollback: true,
            integration: None,
        }
    }
}

/// Whether a session's shell runs with shell integration, and why not (US-5.1, US-5.2.3, protocol 4).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ShellIntegration {
    /// TRC's scripts were injected.
    Injected,
    /// The shell marks its commands itself.
    Native,
    /// Turned off for the session, its profile or its host.
    Off,
    /// The shell is one TRC has no integration for, such as sh, or was started with arguments of its own.
    Unsupported,
    /// A state this version does not know.
    #[serde(other)]
    Unspecified,
}

/// When and why a session came back in a new shell (US-3.1.6, protocol 3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RestoreInfo {
    /// When the session was restored, in milliseconds since the Unix epoch.
    pub at: u64,
    /// Whether the host had restarted, rather than only the session's processes ending.
    pub after_host_restart: bool,
}

/// Why the daemon cannot save a session's scrollback (US-3.1.2, protocol 3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum PersistenceFailure {
    /// The disk is full.
    DiskFull,
    /// The user's disk quota is used up.
    Quota,
    /// The file system is read-only.
    ReadOnly,
    /// Another error, which the daemon's log names.
    Other,
    /// A failure this version does not know.
    #[serde(other)]
    Unspecified,
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
    /// What survives the session's processes ending; absent from daemons before protocol 3.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub options: Option<SessionOptions>,
    /// When the session last came back in a new shell (US-3.1.6).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub restored: Option<RestoreInfo>,
    /// Why its scrollback is not being saved, while it is not (US-3.1.2).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub persistence_failure: Option<PersistenceFailure>,
    /// Whether its shell runs with shell integration (US-5.1, protocol 4); absent from older daemons.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub integration: Option<ShellIntegration>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_options_without_integration_as_on_and_keeps_it_off_us_5_1_3() {
        let older: SessionOptions = serde_json::from_str(r#"{ "restore": true, "saveScrollback": false }"#).unwrap();
        assert!(older.integration_on());
        let off = SessionOptions {
            integration: Some(false),
            ..SessionOptions::default()
        };
        let json = serde_json::to_string(&off).unwrap();
        assert_eq!(json, r#"{"restore":true,"saveScrollback":true,"integration":false}"#);
        assert!(!serde_json::from_str::<SessionOptions>(&json).unwrap().integration_on());
        assert_eq!(
            serde_json::to_string(&SessionOptions::default()).unwrap(),
            r#"{"restore":true,"saveScrollback":true}"#
        );
    }
}
