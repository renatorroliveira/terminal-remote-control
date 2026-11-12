//! The host's sessions in the user's order, with what each holder last reported (US-1.9, US-1.10).

use trc_protocol::{SessionId, SessionInfo, SessionState};

use crate::holder::protocol::{HolderSpec, HolderStatus};

/// One session the core knows about.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionRecord {
    /// What the app sees. `order` is kept equal to the record's position.
    pub info: SessionInfo,
    /// What the holder runs, kept for restart and for adoption by a later core.
    pub spec: HolderSpec,
    /// Whether the session is being closed; it disappears when its holder exits.
    pub closing: bool,
}

impl SessionRecord {
    /// A new session that has not reported yet: state `starting`, at the end of the order.
    pub fn new(id: SessionId, spec: HolderSpec, name: Option<String>) -> Self {
        let info = SessionInfo {
            id,
            custom_name: name,
            title: None,
            order: 0,
            state: SessionState::Starting,
            profile: spec.profile.clone(),
            cwd: spec.cwd.clone(),
            size: spec.size,
            pid: None,
            started_at: None,
            last_output_at: None,
            exit: None,
            failure: None,
        };
        Self {
            info,
            spec,
            closing: false,
        }
    }

    /// Applies a holder's report and returns whether anything the app shows changed.
    pub fn apply_status(&mut self, status: &HolderStatus) -> bool {
        let info = &mut self.info;
        let before = info.clone();
        info.state = status.state;
        info.pid = status.pid;
        info.started_at = status.started_at;
        info.last_output_at = status.last_output_at;
        info.exit.clone_from(&status.exit);
        info.failure.clone_from(&status.failure);
        info.title.clone_from(&status.title);
        if status.cwd.is_some() {
            info.cwd.clone_from(&status.cwd);
        }
        info.size = status.size;
        *info != before
    }
}

/// Every session, in the user-defined order.
#[derive(Debug, Default)]
pub struct Registry {
    sessions: Vec<SessionRecord>,
}

impl Registry {
    /// Appends a session at the end of the order and returns its info.
    pub fn insert(&mut self, mut record: SessionRecord) -> SessionInfo {
        record.info.order = position_number(self.sessions.len());
        let info = record.info.clone();
        self.sessions.push(record);
        info
    }

    /// The session with `id`.
    pub fn get(&self, id: &SessionId) -> Option<&SessionRecord> {
        self.sessions.iter().find(|record| &record.info.id == id)
    }

    /// The session with `id`, for changes.
    pub fn get_mut(&mut self, id: &SessionId) -> Option<&mut SessionRecord> {
        self.sessions.iter_mut().find(|record| &record.info.id == id)
    }

    /// Every session's info, in order.
    pub fn list(&self) -> Vec<SessionInfo> {
        self.sessions.iter().map(|record| record.info.clone()).collect()
    }

    /// Sets or clears the user's name and returns the updated info.
    pub fn rename(&mut self, id: &SessionId, name: Option<String>) -> Option<SessionInfo> {
        let record = self.get_mut(id)?;
        record.info.custom_name = name;
        Some(record.info.clone())
    }

    /// Moves a session to `index`, clamped to the end, and returns the new order.
    pub fn reorder(&mut self, id: &SessionId, index: usize) -> Option<Vec<SessionId>> {
        let from = self.position(id)?;
        let record = self.sessions.remove(from);
        self.sessions.insert(index.min(self.sessions.len()), record);
        self.renumber();
        Some(self.sessions.iter().map(|record| record.info.id.clone()).collect())
    }

    /// Applies a holder's report and returns the updated info when anything the app shows changed.
    pub fn apply_status(&mut self, id: &SessionId, status: &HolderStatus) -> Option<SessionInfo> {
        let record = self.get_mut(id)?;
        record.apply_status(status).then(|| record.info.clone())
    }

    /// Removes a session.
    pub fn remove(&mut self, id: &SessionId) -> Option<SessionRecord> {
        let record = self.sessions.remove(self.position(id)?);
        self.renumber();
        Some(record)
    }

    fn position(&self, id: &SessionId) -> Option<usize> {
        self.sessions.iter().position(|record| &record.info.id == id)
    }

    fn renumber(&mut self) {
        for (index, record) in self.sessions.iter_mut().enumerate() {
            record.info.order = position_number(index);
        }
    }
}

fn position_number(index: usize) -> u32 {
    u32::try_from(index).unwrap_or(u32::MAX)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use trc_protocol::{ExitStatus, Integration, ProfileOrigin, ShellKind, ShellProfile, TerminalSize};

    use super::*;

    fn record(id: &str) -> SessionRecord {
        let profile = ShellProfile {
            id: "login".into(),
            name: "sh".into(),
            origin: ProfileOrigin::Login,
            kind: ShellKind::Sh,
            path: "/bin/sh".into(),
            args: vec![],
            login: true,
            env: BTreeMap::new(),
            cwd: None,
            integration: Integration::Auto,
        };
        let size = TerminalSize { cols: 80, rows: 24 };
        SessionRecord {
            info: SessionInfo {
                id: SessionId(id.into()),
                custom_name: None,
                title: None,
                order: 99,
                state: SessionState::Starting,
                profile: profile.clone(),
                cwd: None,
                size,
                pid: None,
                started_at: None,
                last_output_at: None,
                exit: None,
                failure: None,
            },
            spec: HolderSpec {
                profile,
                cwd: None,
                env: BTreeMap::new(),
                size,
                scrollback_lines: 10_000,
                home: "/home/u".into(),
                user: "u".into(),
            },
            closing: false,
        }
    }

    fn id(text: &str) -> SessionId {
        SessionId(text.into())
    }

    fn ids(registry: &Registry) -> Vec<String> {
        registry.list().into_iter().map(|info| info.id.0).collect()
    }

    fn filled() -> Registry {
        let mut registry = Registry::default();
        for name in ["a", "b", "c"] {
            registry.insert(record(name));
        }
        registry
    }

    #[test]
    fn appends_sessions_and_numbers_their_order() {
        let mut registry = Registry::default();
        assert_eq!(registry.insert(record("a")).order, 0);
        assert_eq!(registry.insert(record("b")).order, 1);
        let orders: Vec<u32> = registry.list().iter().map(|info| info.order).collect();
        assert_eq!(orders, vec![0, 1]);
        assert!(registry.get(&id("b")).is_some());
        assert!(registry.get(&id("z")).is_none());
    }

    #[test]
    fn moves_a_session_and_renumbers() {
        let mut registry = filled();
        assert_eq!(registry.reorder(&id("c"), 0), Some(vec![id("c"), id("a"), id("b")]));
        assert_eq!(registry.list()[0].order, 0);
        assert_eq!(registry.reorder(&id("c"), 7), Some(vec![id("a"), id("b"), id("c")]));
        assert_eq!(registry.reorder(&id("z"), 0), None);
    }

    #[test]
    fn renames_and_clears_the_name() {
        let mut registry = filled();
        assert_eq!(
            registry
                .rename(&id("b"), Some("build".into()))
                .and_then(|i| i.custom_name),
            Some("build".into())
        );
        assert_eq!(registry.rename(&id("b"), None).map(|i| i.custom_name), Some(None));
        assert_eq!(registry.rename(&id("z"), None), None);
    }

    #[test]
    fn applies_holder_status_and_reports_only_changes() {
        let mut registry = filled();
        let status = HolderStatus {
            state: SessionState::Exited,
            pid: None,
            started_at: Some(1),
            last_output_at: Some(2),
            exit: Some(ExitStatus {
                code: Some(3),
                signal: None,
            }),
            failure: None,
            title: Some("vim".into()),
            cwd: Some("/tmp".into()),
            size: TerminalSize { cols: 100, rows: 30 },
        };
        let info = registry.apply_status(&id("b"), &status).unwrap();
        assert_eq!(
            (info.state, info.order, info.title.as_deref()),
            (SessionState::Exited, 1, Some("vim"))
        );
        assert_eq!(info.exit.and_then(|exit| exit.code), Some(3));
        assert_eq!(info.size.cols, 100);
        assert_eq!(registry.apply_status(&id("b"), &status), None);
        assert_eq!(registry.apply_status(&id("z"), &status), None);
    }

    #[test]
    fn removes_sessions() {
        let mut registry = filled();
        assert!(registry.remove(&id("a")).is_some());
        assert_eq!(ids(&registry), vec!["b".to_owned(), "c".to_owned()]);
        assert_eq!(registry.list()[0].order, 0);
        assert!(registry.get_mut(&id("a")).is_none());
    }
}
