//! Shell profiles (TECH_STACK §8): which shell a session runs, detected per host.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The family of a shell, which selects its shell integration.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ShellKind {
    /// GNU bash.
    Bash,
    /// zsh.
    Zsh,
    /// fish.
    Fish,
    /// PowerShell 7.
    Pwsh,
    /// Windows PowerShell 5.1.
    Powershell,
    /// cmd.exe.
    Cmd,
    /// A WSL distribution.
    Wsl,
    /// A POSIX `sh`.
    Sh,
    /// Any other shell.
    Other,
    /// A kind this version does not know.
    #[serde(other)]
    Unspecified,
}

/// Where a profile came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ProfileOrigin {
    /// The account's login shell.
    Login,
    /// Found in `/etc/shells` or on `PATH`.
    Detected,
    /// Defined by the user.
    User,
    /// An origin this version does not know.
    #[serde(other)]
    Unspecified,
}

/// Whether the daemon injects its shell-integration scripts (E4).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Integration {
    /// Inject when the shell kind supports it.
    Auto,
    /// Never inject.
    Off,
    /// A mode this version does not know.
    #[serde(other)]
    Unspecified,
}

/// A shell a session can run on one host. Each session keeps a resolved copy so a restart runs the same shell.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ShellProfile {
    /// `login`, `detected:<name>` or a user-chosen identifier.
    pub id: String,
    /// The name shown to the user.
    pub name: String,
    /// Where the profile came from.
    pub origin: ProfileOrigin,
    /// The shell family.
    pub kind: ShellKind,
    /// Absolute path of the shell on the host.
    pub path: String,
    /// Arguments after the program name.
    #[serde(default)]
    pub args: Vec<String>,
    /// Whether the shell starts as a login shell (`argv[0]` of `-zsh`).
    pub login: bool,
    /// Environment overrides; `null` unsets a variable.
    #[serde(default)]
    pub env: BTreeMap<String, Option<String>>,
    /// The working directory, when the profile fixes one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cwd: Option<String>,
    /// Shell-integration mode.
    pub integration: Integration,
}
