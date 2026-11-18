//! Messages between the core and a holder, carried as `CONTROL` frames on the holder's socket. In holder protocol 2,
//! `OUTPUT`, `INPUT` and `CREDIT` frames carry the attachment as their stream; protocol 1 (E1) has one attachment, on
//! [`SESSION_STREAM`].

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use trc_protocol::{
    ExitStatus, PersistenceFailure, Replay, ResyncKind, SessionOptions, SessionState, ShellIntegration, ShellProfile,
    TerminalSize,
};

/// The stream of holder protocol 1's one attachment, and of an attachment a protocol 1 core makes.
pub const SESSION_STREAM: u32 = 1;
/// The holder protocol this build speaks; it also serves protocol 1 to 3 cores. Protocol 3 adds saving to disk, and
/// protocol 4 the bell, finished commands and the shell's integration (US-5.3, P-75).
pub const HOLDER_PROTOCOL: u32 = 4;

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
    /// What survives the session's processes ending (US-3.2, holder protocol 3).
    #[serde(default)]
    pub options: SessionOptions,
    /// The session's data folder, where it saves its scrollback (TECH_STACK §5.5); none from older cores.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data_dir: Option<String>,
    /// The shell-integration scripts' folder, which the core wrote (US-5.1, P-73); none from older cores, or when the
    /// core could not write it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub integration_dir: Option<String>,
}

/// How a holder brings back a session whose processes ended (US-3.1): its saved scrollback, lines below it, and then
/// the same shell again, or the session as it ended.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HolderRestore {
    /// Lines written below the saved scrollback: the marker, and a note when the shell's folder is gone.
    pub lines: Vec<String>,
    /// Whether the shell starts again; otherwise the session reports the state below and runs nothing (P-41).
    pub start_shell: bool,
    /// The state of a session that stays ended.
    pub state: SessionState,
    /// How it ended.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exit: Option<ExitStatus>,
    /// Why it failed to start, for one that never did.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure: Option<String>,
}

/// A request from the core.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum HolderCommand {
    /// Starts the session. Sent once, on the first connection.
    Start {
        /// What to start.
        spec: Box<HolderSpec>,
        /// How to bring back a session whose processes ended, from its saved scrollback (holder protocol 3).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        restore: Option<Box<HolderRestore>>,
    },
    /// Starts an attachment: what the client lacks, then live output, within the given credit.
    Attach {
        /// Output bytes the client may receive before it grants more.
        credit: u32,
        /// The attachment, which is also its stream; absent from a protocol 1 core, which has one.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        attachment: Option<u32>,
        /// The first offset the client lacks; a snapshot replaces its terminal when absent or too old.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        from_offset: Option<u64>,
        /// Whether the client speaks app protocol 1, so a resync is an in-band reset and the whole snapshot.
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        legacy: bool,
    },
    /// Ends an attachment; every attachment when absent, as from a protocol 1 core.
    Detach {
        /// The attachment.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        attachment: Option<u32>,
    },
    /// Sends an attachment the whole scrollback and screen again (D-45).
    Refresh {
        /// The attachment.
        attachment: u32,
    },
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
    /// Changes what survives the processes ending; turning saving off deletes what is on disk (holder protocol 3).
    SetOptions {
        /// The new options.
        options: SessionOptions,
    },
    /// Clears the scrollback for every client and on disk (US-3.2.3, holder protocol 3).
    ClearScrollback,
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
    /// Why the scrollback is not being saved, while it is not (holder protocol 3).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub persistence_failure: Option<PersistenceFailure>,
    /// Whether the shell runs with shell integration (US-5.1, holder protocol 4).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub integration: Option<ShellIntegration>,
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
        /// The holder protocol the holder speaks; absent from protocol 1 holders.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        proto: Option<u32>,
    },
    /// Answers `attach`: what the output that follows brings.
    Attached {
        /// The attachment.
        attachment: u32,
        /// The missed output or a snapshot.
        replay: Replay,
    },
    /// Every output byte after this on the attachment is live output, the first at `offset`.
    Synced {
        /// The attachment.
        attachment: u32,
        /// The offset of the next output byte.
        offset: u64,
    },
    /// The attachment fell behind or asked for `refresh`: the output up to `synced` recreates the terminal.
    Resync {
        /// The attachment.
        attachment: u32,
        /// What follows.
        kind: ResyncKind,
    },
    /// Another attachment sent input.
    PeerInput {
        /// The attachment told.
        attachment: u32,
    },
    /// The session changed.
    Status {
        /// The session after the change.
        status: HolderStatus,
    },
    /// The holder is exiting after `shutdown`.
    Exiting,
    /// The program rang the bell; at most one a second (US-5.3, holder protocol 4).
    Bell,
    /// A command finished, as shell integration marked it (US-5.2.2, US-5.3, holder protocol 4).
    CommandFinished {
        /// Its exit code, when the shell reported one.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        exit_code: Option<i32>,
        /// How long it ran, in milliseconds.
        duration_ms: u64,
    },
}
