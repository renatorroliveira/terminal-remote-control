//! Sessions on disk (US-3.1, US-3.2, TECH_STACK §5.5): every session's record kept current in its `meta.json`, and
//! every session whose holder is gone brought back, at the core's start and whenever a holder dies: in a new shell
//! below its saved scrollback, or as it ended (P-40, P-41).

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use trc_protocol::{EndCause, RestoreInfo, ServerMessage, SessionChange, SessionId, SessionInfo, SessionState};

use super::Core;
use crate::core::registry::SessionRecord;
use crate::core::restore::{Recovery, ended_exit, ended_marker, missing_folder_note, recovery, restore_marker};
use crate::core::store::SessionMeta;
use crate::holder::protocol::{HolderCommand, HolderRestore, HolderSpec};
use crate::time::now_millis;

impl Core {
    /// Writes a session's `meta.json` when what it keeps has changed since it was last written.
    pub(super) fn persist(&mut self, session: &SessionId) {
        let Some(record) = self.registry.get(session) else {
            return;
        };
        let meta = SessionMeta::of(
            &record.info,
            &record.spec,
            self.context.boot_id.as_deref(),
            record.closing,
        );
        if self.written.get(session) == Some(&meta) {
            return;
        }
        self.context.store.write(&meta);
        self.written.insert(session.clone(), meta);
    }

    /// Writes every session's record that changed, as a new order changes them all.
    pub(super) fn persist_all(&mut self) {
        for session in self.registry.ids() {
            self.persist(&session);
        }
    }

    /// Brings back every saved session that no live holder serves and that the user had not closed, deletes those
    /// they had, then lists every session in its saved order.
    pub(super) fn recover_saved(&mut self, live: &BTreeSet<SessionId>) {
        let saved = self.context.store.read_all();
        let order: BTreeMap<SessionId, u32> = saved
            .iter()
            .map(|meta| (meta.info.id.clone(), meta.info.order))
            .collect();
        let (served, gone): (Vec<SessionMeta>, Vec<SessionMeta>) =
            saved.into_iter().partition(|meta| live.contains(&meta.info.id));
        for meta in &served {
            self.settle_adopted(meta);
        }
        let (closed, mut gone): (Vec<SessionMeta>, Vec<SessionMeta>) = gone.into_iter().partition(|meta| meta.closing);
        for meta in closed {
            self.context.store.remove(&meta.info.id);
        }
        gone.sort_by_key(|meta| meta.info.order);
        tracing::info!(sessions = gone.len(), "bringing back saved sessions");
        for meta in gone {
            let Recovered { record, restore } = self.recovered(meta);
            let (id, spec, name) = (
                record.info.id.clone(),
                record.spec.clone(),
                record.info.custom_name.clone(),
            );
            self.registry.insert(record);
            self.launch(id, spec, name, Some(restore));
        }
        self.registry.arrange(&order);
        self.persist_all();
    }

    /// Gives an adopted session what only its record kept: when it was restored, and whether the user had closed it,
    /// in which case it closes now.
    pub(super) fn settle_adopted(&mut self, meta: &SessionMeta) {
        let session = &meta.info.id;
        let Some(record) = self.registry.get_mut(session) else {
            return;
        };
        if record.info.restored.is_none() {
            record.info.restored = meta.info.restored;
        }
        if !meta.closing {
            return;
        }
        record.closing = true;
        if !self.holder_command(session, &HolderCommand::Shutdown) {
            self.forget(session);
        }
    }

    /// A holder ended while its session was not being closed: the session comes back where it stands in the list.
    pub(super) fn recover_in_place(&mut self, session: &SessionId) {
        let Some(record) = self.registry.get(session) else {
            return;
        };
        let meta = SessionMeta::of(&record.info, &record.spec, self.context.boot_id.as_deref(), false);
        let Recovered { record, restore } = self.recovered(meta);
        let (id, spec, name) = (
            record.info.id.clone(),
            record.spec.clone(),
            record.info.custom_name.clone(),
        );
        let Some(info) = self.registry.replace(record) else {
            return;
        };
        tracing::warn!(session = %id.0, restored = restore.start_shell, "a session's holder ended; it comes back");
        self.launch(id.clone(), spec, name, Some(restore));
        self.persist(&id);
        self.broadcast(&ServerMessage::SessionEvent {
            change: SessionChange::Updated { session: info },
        });
    }

    /// The record of a session brought back from `meta`, and what its new holder starts with.
    fn recovered(&self, meta: SessionMeta) -> Recovered {
        let now = now_millis();
        let plan = recovery(&meta, self.context.boot_id.as_deref(), now);
        let SessionMeta { mut info, mut spec, .. } = meta;
        spec.data_dir = Some(self.context.store.session_dir(&info.id).to_string_lossy().into_owned());
        let restore = match plan {
            Recovery::Restore { after_host_restart } => restoring(
                &mut info,
                &mut spec,
                &self.context.account.home,
                after_host_restart,
                now,
            ),
            Recovery::Keep { ended } => kept(&mut info, ended, now),
        };
        Recovered {
            record: SessionRecord {
                info,
                spec,
                closing: false,
            },
            restore,
        }
    }
}

/// A session brought back: its record, and what its new holder starts with.
struct Recovered {
    record: SessionRecord,
    restore: HolderRestore,
}

/// Sets a session up to start its shell again in its last folder, or the home folder when that one is gone.
fn restoring(
    info: &mut SessionInfo,
    spec: &mut HolderSpec,
    home: &str,
    after_host_restart: bool,
    now: u64,
) -> HolderRestore {
    let mut lines = vec![restore_marker(after_host_restart, now)];
    match info.cwd.clone().or_else(|| spec.cwd.clone()) {
        Some(folder) if Path::new(&folder).is_dir() => spec.cwd = Some(folder),
        Some(folder) => {
            lines.push(missing_folder_note(&folder));
            spec.cwd = Some(home.to_owned());
        }
        None => {}
    }
    info.state = SessionState::Starting;
    info.cwd.clone_from(&spec.cwd);
    info.pid = None;
    info.exit = None;
    info.failure = None;
    info.restored = Some(RestoreInfo {
        at: now,
        after_host_restart,
    });
    HolderRestore {
        lines,
        start_shell: true,
        state: SessionState::Starting,
        exit: None,
        failure: None,
    }
}

/// Keeps a session ended: one that was running says what ended its processes, below its saved scrollback.
fn kept(info: &mut SessionInfo, ended: Option<EndCause>, now: u64) -> HolderRestore {
    let lines = ended.map(|cause| ended_marker(cause, now)).into_iter().collect();
    if let Some(cause) = ended {
        info.state = SessionState::Exited;
        info.exit = Some(ended_exit(cause));
        info.failure = None;
    }
    info.pid = None;
    HolderRestore {
        lines,
        start_shell: false,
        state: info.state,
        exit: info.exit.clone(),
        failure: info.failure.clone(),
    }
}
