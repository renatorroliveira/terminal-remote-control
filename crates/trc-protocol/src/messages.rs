//! Control messages: JSON tagged unions carried in `CONTROL` frames on stream 0.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::profile::ShellProfile;
use crate::session::{SessionId, SessionInfo, SessionOptions, TerminalSize};

/// What the app asks for when it creates a session (US-1.7).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CreateSessionSpec {
    /// The profile to run; the login shell when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub profile_id: Option<String>,
    /// The working directory; the home directory when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cwd: Option<String>,
    /// A name chosen by the user.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub name: Option<String>,
    /// Environment overrides; `null` unsets a variable.
    #[serde(default)]
    pub env: BTreeMap<String, Option<String>>,
    /// The initial PTY size.
    pub size: TerminalSize,
    /// The scrollback limit in lines (NFR-10).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub scrollback_lines: Option<u32>,
    /// What survives the session's processes ending (US-3.2, protocol 3); both on when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub options: Option<SessionOptions>,
}

/// How much of a session an attached client receives.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum AttachMode {
    /// The screen snapshot, then live output.
    Full,
    /// Session events only (E5).
    Events,
    /// A mode this version does not know.
    #[serde(other)]
    Unspecified,
}

/// How an attach brings a client up to date (protocol 2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Replay {
    /// The output since the client's `fromOffset`, which the client adds to the terminal it has.
    Delta,
    /// The whole scrollback and screen, which replace whatever the client shows.
    Snapshot,
    /// A replay this version does not know.
    #[serde(other)]
    Unspecified,
}

/// What a client that fell behind receives instead of the output it missed (protocol 2, D-04, D-45).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ResyncKind {
    /// Only the current screen; the scrollback the client skipped is missing until it asks for `refresh`.
    Screen,
    /// The whole scrollback and screen.
    Full,
    /// A kind this version does not know.
    #[serde(other)]
    Unspecified,
}

/// Why the daemon ended a client's attachment without being asked (protocol 2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum DetachReason {
    /// Another client opened a session whose holder serves one client at a time (an E1 holder, P-27).
    AttachedElsewhere,
    /// A reason this version does not know.
    #[serde(other)]
    Unspecified,
}

/// What runs the host's daemon (US-2.4).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ServiceManager {
    /// The user's systemd instance, which restarts the daemon after a crash.
    Systemd,
    /// Nothing: the daemon runs detached, and the app starts it again when it finds it stopped.
    Detached,
    /// A manager this version does not know.
    #[serde(other)]
    Unspecified,
}

/// How the host's daemon runs, and whether its sessions outlive logout (US-2.4).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ServiceInfo {
    /// What runs the daemon.
    pub manager: ServiceManager,
    /// Whether the host ends the user's processes once the last connection closes, so sessions end with it
    /// (US-2.4.4).
    pub sessions_end_at_logout: bool,
}

/// Where the host's daemon keeps its files and since when it runs: the host's details (US-3.3.1), and the home
/// folder that session names shorten to `~` (P-48).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DaemonDetails {
    /// The account's home folder.
    pub home: String,
    /// The install root the daemon runs from.
    pub install_root: String,
    /// The folder the daemon writes its logs to.
    pub log_dir: String,
    /// When the core started, in milliseconds since the Unix epoch.
    pub started_at: u64,
}

/// Why a request failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ErrorCode {
    /// The message could not be parsed or broke a rule.
    BadRequest,
    /// No session has the given identifier.
    UnknownSession,
    /// The request is valid but this daemon does not support it.
    Unsupported,
    /// The PTY or process could not be created.
    SpawnFailed,
    /// Anything else.
    Internal,
    /// A code this version does not know.
    #[serde(other)]
    Unspecified,
}

/// A change to the host's session list, pushed to every client.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[ts(export)]
pub enum SessionChange {
    /// A session was created.
    Created {
        /// The new session.
        session: SessionInfo,
    },
    /// A session's state, name, title, size or working directory changed.
    Updated {
        /// The session after the change.
        session: SessionInfo,
    },
    /// A session was closed and its scrollback deleted.
    Closed {
        /// The closed session.
        session_id: SessionId,
    },
    /// The user-defined order changed.
    Reordered {
        /// Every session, in the new order.
        order: Vec<SessionId>,
    },
}

/// A message from the app to the daemon. Every request but `hello` carries a `requestId`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[ts(export)]
pub enum ClientMessage {
    /// The first message on a connection: the protocol range and capabilities the app speaks.
    Hello {
        /// Oldest protocol version the app speaks.
        min_proto: u32,
        /// Newest protocol version the app speaks.
        max_proto: u32,
        /// The app's version.
        app_version: String,
        /// Optional features the app supports.
        caps: Vec<String>,
    },
    /// Liveness check (NFR-07).
    Ping {
        /// Correlates the reply.
        request_id: u32,
    },
    /// Lists the host's sessions.
    ListSessions {
        /// Correlates the reply.
        request_id: u32,
    },
    /// Lists the host's shell profiles.
    ListProfiles {
        /// Correlates the reply.
        request_id: u32,
    },
    /// Creates a session.
    Create {
        /// Correlates the reply.
        request_id: u32,
        /// What to create.
        spec: CreateSessionSpec,
    },
    /// Sets or clears the user's name for a session.
    Rename {
        /// Correlates the reply.
        request_id: u32,
        /// The session.
        session: SessionId,
        /// The new name; absent clears it so the program title shows again.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        name: Option<String>,
    },
    /// Moves a session to a position in the order.
    Reorder {
        /// Correlates the reply.
        request_id: u32,
        /// The session.
        session: SessionId,
        /// The new position, starting at 0.
        index: u32,
    },
    /// Stops a session's process: SIGHUP, then SIGTERM, then SIGKILL after the grace period (US-1.10.2).
    Stop {
        /// Correlates the reply.
        request_id: u32,
        /// The session.
        session: SessionId,
        /// Milliseconds between the signals; the daemon default when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        grace_ms: Option<u32>,
    },
    /// Stops the process if it runs, then starts the same shell again (US-1.10.3).
    Restart {
        /// Correlates the reply.
        request_id: u32,
        /// The session.
        session: SessionId,
    },
    /// Stops the process if it runs, then removes the session and its scrollback (US-1.10.4).
    Close {
        /// Correlates the reply.
        request_id: u32,
        /// The session.
        session: SessionId,
    },
    /// Attaches to a session's output.
    Attach {
        /// Correlates the reply.
        request_id: u32,
        /// The session.
        session: SessionId,
        /// How much to receive.
        mode: AttachMode,
        /// The offset of the first output byte the client has not received, to replay only what it missed
        /// (protocol 2, US-2.2.2).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        from_offset: Option<u64>,
    },
    /// Asks for the whole scrollback and screen of an attached session again, after a `resync` of the screen
    /// left a gap (protocol 2, D-45). Answered by `done`; the `resync` follows on the session's stream.
    Refresh {
        /// Correlates the reply.
        request_id: u32,
        /// The session.
        session: SessionId,
    },
    /// Stops receiving a session's output. The session keeps running.
    Detach {
        /// Correlates the reply.
        request_id: u32,
        /// The session.
        session: SessionId,
    },
    /// Changes what survives a session's processes ending (US-3.2, protocol 3). Answered by `done`; turning
    /// `saveScrollback` off deletes what is on disk at once.
    SetSessionOptions {
        /// Correlates the reply.
        request_id: u32,
        /// The session.
        session: SessionId,
        /// The new options.
        options: SessionOptions,
    },
    /// Clears a session's scrollback, for every client and on disk (US-3.2.3, protocol 3). Answered by `done`.
    ClearScrollback {
        /// Correlates the reply.
        request_id: u32,
        /// The session.
        session: SessionId,
    },
    /// Restarts the daemon's core; every session keeps running (US-3.3.2, protocol 3). Answered by `done`, then the
    /// connection ends and the app reconnects.
    RestartDaemon {
        /// Correlates the reply.
        request_id: u32,
    },
    /// Stops every session and deletes their data, then stops the daemon (US-3.3.3, protocol 3). Answered by `done`
    /// once every session has ended; the app then removes the binaries.
    RemoveDaemon {
        /// Correlates the reply.
        request_id: u32,
        /// Milliseconds between the stop signals; the daemon default when absent.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        grace_ms: Option<u32>,
    },
    /// Resizes a session's PTY (US-1.11.3).
    Resize {
        /// Correlates the reply.
        request_id: u32,
        /// The session.
        session: SessionId,
        /// The new size.
        size: TerminalSize,
    },
}

/// A message from the daemon to the app. The app treats every field as untrusted (SEC-06).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[ts(export)]
pub enum ServerMessage {
    /// Accepts the handshake.
    Welcome {
        /// The negotiated protocol version.
        proto: u32,
        /// The daemon's version.
        daemon_version: String,
        /// SHA-256 of the running daemon binary, in hex.
        binary_sha256: String,
        /// Optional features the daemon supports.
        caps: Vec<String>,
        /// How the daemon runs (protocol 2).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        service: Option<ServiceInfo>,
        /// Where the daemon keeps its files and since when it runs; absent from daemons before 0.4.0.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        details: Option<DaemonDetails>,
    },
    /// Refuses the handshake: no common protocol version (US-1.4.6).
    Incompatible {
        /// Oldest protocol version the daemon speaks.
        min_proto: u32,
        /// Newest protocol version the daemon speaks.
        max_proto: u32,
    },
    /// Answers `ping`.
    Pong {
        /// The request this answers.
        request_id: u32,
    },
    /// Answers `listSessions`.
    Sessions {
        /// The request this answers.
        request_id: u32,
        /// Every session, in the user-defined order.
        sessions: Vec<SessionInfo>,
    },
    /// Answers `listProfiles`.
    Profiles {
        /// The request this answers.
        request_id: u32,
        /// Every profile the host offers, the login shell first.
        profiles: Vec<ShellProfile>,
    },
    /// Answers `create`.
    Created {
        /// The request this answers.
        request_id: u32,
        /// The new session.
        session: SessionInfo,
    },
    /// Answers `attach`: the snapshot and then live output follow as `OUTPUT` frames on `stream`.
    Attached {
        /// The request this answers.
        request_id: u32,
        /// The session.
        session: SessionId,
        /// The stream that carries the session's output and input.
        stream: u32,
        /// Output bytes the app may receive before it grants more credit.
        credit: u32,
        /// What the output that follows brings: the missed output or a snapshot, ending with `synced`
        /// (protocol 2).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        replay: Option<Replay>,
    },
    /// Ends a replay or resync: every output byte after it on `stream` is live output, the first at `offset`
    /// (protocol 2).
    Synced {
        /// The session.
        session: SessionId,
        /// The session's stream.
        stream: u32,
        /// The offset of the next output byte.
        offset: u64,
    },
    /// Starts a resync of a client that fell behind: the client resets its terminal, and the output that follows
    /// up to `synced` recreates it (protocol 2, D-04).
    Resync {
        /// The session.
        session: SessionId,
        /// The session's stream.
        stream: u32,
        /// What the resync sends.
        kind: ResyncKind,
    },
    /// Another client typed into the session (protocol 2, US-2.6.4). Sent at most once a second.
    PeerInput {
        /// The session.
        session: SessionId,
        /// The session's stream.
        stream: u32,
    },
    /// The daemon ended the client's attachment to the session: no more output comes on `stream`, and input sent
    /// on it is dropped until the client attaches again (protocol 2).
    Detached {
        /// The session.
        session: SessionId,
        /// The stream that ended.
        stream: u32,
        /// Why it ended.
        reason: DetachReason,
    },
    /// Answers a request that returns nothing else.
    Done {
        /// The request this answers.
        request_id: u32,
    },
    /// A change to the session list.
    SessionEvent {
        /// What changed.
        change: SessionChange,
    },
    /// A request failed.
    Error {
        /// The request this answers, when the failure belongs to one.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        request_id: Option<u32>,
        /// Why it failed.
        code: ErrorCode,
        /// A description for logs and copyable details. It never contains terminal content.
        message: String,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tags_messages_by_type_with_camel_case_fields() {
        let json = serde_json::to_value(ClientMessage::Ping { request_id: 7 }).unwrap();
        assert_eq!(json, serde_json::json!({ "type": "ping", "requestId": 7 }));
    }

    #[test]
    fn ignores_unknown_fields() {
        let message: ServerMessage =
            serde_json::from_str(r#"{ "type": "pong", "requestId": 3, "addedLater": true }"#).unwrap();
        assert_eq!(message, ServerMessage::Pong { request_id: 3 });
    }

    #[test]
    fn maps_unknown_enum_values_to_unspecified() {
        let message: ServerMessage =
            serde_json::from_str(r#"{ "type": "error", "code": "quotaExceeded", "message": "x" }"#).unwrap();
        assert_eq!(
            message,
            ServerMessage::Error {
                request_id: None,
                code: ErrorCode::Unspecified,
                message: "x".into()
            }
        );
    }

    #[test]
    fn rejects_unknown_message_types() {
        assert!(serde_json::from_str::<ClientMessage>(r#"{ "type": "selfDestruct", "requestId": 1 }"#).is_err());
    }
}
