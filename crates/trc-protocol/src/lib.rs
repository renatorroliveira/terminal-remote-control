//! Wire protocol between the desktop app and `trcd`: frame codec, control messages and version negotiation.

pub mod frame;
pub mod messages;
pub mod profile;
pub mod session;
pub mod version;

pub use messages::{
    AttachMode, ClientMessage, CreateSessionSpec, DaemonDetails, DetachReason, ErrorCode, Replay, ResyncKind,
    ServerMessage, ServiceInfo, ServiceManager, SessionActivity, SessionChange,
};
pub use profile::{Integration, ProfileOrigin, ShellKind, ShellProfile};
pub use session::{
    EndCause, ExitStatus, PersistenceFailure, RestoreInfo, SessionId, SessionInfo, SessionOptions, SessionState,
    ShellIntegration, TerminalSize,
};
pub use version::{MIN_PROTOCOL_VERSION, PROTOCOL_VERSION, negotiate};
