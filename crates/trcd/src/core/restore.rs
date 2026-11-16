//! What the core does with a session whose holder is gone (US-3.1, P-40, P-41): restore it in a new shell below its
//! saved scrollback and a marker, or keep it listed as it was, with its saved scrollback.

use trc_protocol::{EndCause, ExitStatus, SessionState};

use super::store::SessionMeta;
use crate::time::format_utc;

/// How long after a restore the same session is not restored again, so a shell that cannot start never loops.
pub const RESTORE_AGAIN_AFTER_MS: u64 = 30_000;

/// What happens to a session whose holder is gone.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Recovery {
    /// The same shell starts again below the saved scrollback and a marker.
    Restore {
        /// Whether the host restarted since the session last ran.
        after_host_restart: bool,
    },
    /// The session stays ended, with its saved scrollback.
    Keep {
        /// What ended its processes, when they were running; none for one that had exited or been stopped.
        ended: Option<EndCause>,
    },
}

/// Decides a session's recovery from its record, the host's boot ID now, and the time now: one that was running and
/// that the user had not stopped or closed is restored unless its restore is off or it was restored a moment ago.
pub fn recovery(meta: &SessionMeta, boot_id: Option<&str>, now: u64) -> Recovery {
    let after_host_restart = matches!((meta.boot_id.as_deref(), boot_id), (Some(then), Some(now)) if then != now);
    let was_running = matches!(meta.info.state, SessionState::Starting | SessionState::Running);
    let just_restored = meta
        .info
        .restored
        .is_some_and(|restored| now.saturating_sub(restored.at) < RESTORE_AGAIN_AFTER_MS);
    if !was_running {
        return Recovery::Keep { ended: None };
    }
    if meta.spec.options.restore && (after_host_restart || !just_restored) {
        return Recovery::Restore { after_host_restart };
    }
    Recovery::Keep {
        ended: Some(if after_host_restart {
            EndCause::HostRestart
        } else {
            EndCause::ProcessesEnded
        }),
    }
}

/// The line below a restored session's saved scrollback (US-3.1.4).
pub fn restore_marker(after_host_restart: bool, at: u64) -> String {
    if after_host_restart {
        format!(
            "Session restored after restart on {}. Previous processes ended.",
            format_utc(at)
        )
    } else {
        format!("Session restored on {}. Previous processes ended.", format_utc(at))
    }
}

/// The line below the saved scrollback of a session that stays ended because its processes ended (P-41).
pub fn ended_marker(cause: EndCause, at: u64) -> String {
    match cause {
        EndCause::HostRestart => format!("Session ended by a restart of the host on {}.", format_utc(at)),
        EndCause::ProcessesEnded | EndCause::Unspecified => {
            format!("Session ended on {}: its processes ended.", format_utc(at))
        }
    }
}

/// The line that says a restored shell starts in the home folder, as its folder is gone (US-3.1.7).
pub fn missing_folder_note(folder: &str) -> String {
    format!("The folder {folder} no longer exists, so the shell starts in your home folder.")
}

/// The exit status of a session its processes ended without (P-41).
pub fn ended_exit(cause: EndCause) -> ExitStatus {
    ExitStatus {
        code: None,
        signal: None,
        ended: Some(cause),
    }
}

#[cfg(test)]
mod tests {
    use trc_protocol::RestoreInfo;

    use super::*;
    use crate::core::store::sample_meta;

    const NOW: u64 = 1_794_400_000_000;

    fn meta(state: SessionState, restore: bool) -> SessionMeta {
        sample_meta("0123456789abcdef", 0, state, restore)
    }

    #[test]
    fn restores_a_running_session_and_says_whether_the_host_restarted() {
        let running = meta(SessionState::Running, true);
        assert_eq!(
            recovery(&running, Some("boot-1"), NOW),
            Recovery::Restore {
                after_host_restart: false
            }
        );
        assert_eq!(
            recovery(&running, Some("boot-2"), NOW),
            Recovery::Restore {
                after_host_restart: true
            }
        );
        assert_eq!(
            recovery(&running, None, NOW),
            Recovery::Restore {
                after_host_restart: false
            }
        );
    }

    #[test]
    fn keeps_a_session_ended_when_its_restore_is_off() {
        assert_eq!(
            recovery(&meta(SessionState::Running, false), Some("boot-2"), NOW),
            Recovery::Keep {
                ended: Some(EndCause::HostRestart)
            }
        );
        assert_eq!(
            recovery(&meta(SessionState::Starting, false), Some("boot-1"), NOW),
            Recovery::Keep {
                ended: Some(EndCause::ProcessesEnded)
            }
        );
    }

    #[test]
    fn keeps_a_session_that_had_exited_or_been_stopped_as_it_was() {
        for state in [SessionState::Exited, SessionState::Stopped, SessionState::FailedToStart] {
            assert_eq!(
                recovery(&meta(state, true), Some("boot-2"), NOW),
                Recovery::Keep { ended: None }
            );
        }
    }

    #[test]
    fn does_not_restore_a_session_again_moments_after_it_was_unless_the_host_restarted() {
        let mut again = meta(SessionState::Running, true);
        again.info.restored = Some(RestoreInfo {
            at: NOW - 1_000,
            after_host_restart: false,
        });
        assert_eq!(
            recovery(&again, Some("boot-1"), NOW),
            Recovery::Keep {
                ended: Some(EndCause::ProcessesEnded)
            }
        );
        assert!(matches!(
            recovery(&again, Some("boot-2"), NOW),
            Recovery::Restore { .. }
        ));
        assert!(matches!(
            recovery(&again, Some("boot-1"), NOW + RESTORE_AGAIN_AFTER_MS),
            Recovery::Restore { .. }
        ));
    }

    #[test]
    fn writes_the_prd_marker_lines() {
        assert_eq!(
            restore_marker(true, 0),
            "Session restored after restart on 1970-01-01 00:00:00 UTC. Previous processes ended."
        );
        assert_eq!(
            restore_marker(false, 0),
            "Session restored on 1970-01-01 00:00:00 UTC. Previous processes ended."
        );
        assert_eq!(
            ended_marker(EndCause::HostRestart, 0),
            "Session ended by a restart of the host on 1970-01-01 00:00:00 UTC."
        );
        assert!(missing_folder_note("/gone").contains("/gone"));
    }
}
