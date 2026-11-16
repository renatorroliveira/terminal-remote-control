//! Every session's `meta.json` in its data folder (TECH_STACK §5.5, SEC-05.1): what the core needs to list it again
//! and start it again after its processes ended (US-3.1.3), written whenever any of that changes. Each write goes to
//! a temporary file that is synced, then renamed over the old one, and the folder is synced.

use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use trc_protocol::{SessionId, SessionInfo};

use crate::holder::protocol::HolderSpec;
use crate::private_dir::ensure_private_dir;
use crate::session_id::is_session_id;

/// The file's name in a session's data folder.
pub const META_FILE: &str = "meta.json";
const FORMAT: u32 = 1;

/// What the core keeps of one session on disk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMeta {
    /// The format of this file.
    pub format: u32,
    /// The session as the app last saw it: name, order, state, exit, working directory, size and options.
    pub info: SessionInfo,
    /// What its holder runs.
    pub spec: HolderSpec,
    /// The host's boot ID when it was written, which tells a host restart from processes that only ended.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub boot_id: Option<String>,
}

impl SessionMeta {
    /// The record of a session as it is now.
    pub fn of(info: &SessionInfo, spec: &HolderSpec, boot_id: Option<&str>) -> Self {
        Self {
            format: FORMAT,
            info: persisted(info),
            spec: spec.clone(),
            boot_id: boot_id.map(str::to_owned),
        }
    }
}

/// The `meta.json` files under `<root>/sessions`.
pub struct SessionStore {
    dir: PathBuf,
    uid: u32,
}

impl SessionStore {
    /// The store of the sessions folder `dir`, whose folders belong to `uid`.
    pub fn new(dir: PathBuf, uid: u32) -> Self {
        Self { dir, uid }
    }

    /// A session's data folder.
    pub fn session_dir(&self, session: &SessionId) -> PathBuf {
        self.dir.join(&session.0)
    }

    /// Creates a session's data folder, private (SEC-05.1), and returns it.
    pub fn prepare(&self, session: &SessionId) -> io::Result<PathBuf> {
        let dir = self.session_dir(session);
        ensure_private_dir(&dir, self.uid)?;
        Ok(dir)
    }

    /// Writes a session's record; the old one stays whole until the new one has replaced it.
    pub fn write(&self, meta: &SessionMeta) -> io::Result<()> {
        let dir = self.prepare(&meta.info.id)?;
        let encoded = serde_json::to_vec(meta).map_err(io::Error::other)?;
        let temporary = dir.join(format!("{META_FILE}.new"));
        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .mode(0o600)
            .custom_flags(rustix::fs::OFlags::NOFOLLOW.bits().cast_signed())
            .open(&temporary)?;
        file.write_all(&encoded)?;
        file.sync_all()?;
        std::fs::rename(&temporary, dir.join(META_FILE))?;
        File::open(&dir)?.sync_all()
    }

    /// Every session's record that can be read, in no order; a folder whose record is missing or unreadable is
    /// logged and left alone.
    pub fn read_all(&self) -> Vec<SessionMeta> {
        let Ok(entries) = std::fs::read_dir(&self.dir) else {
            return Vec::new();
        };
        entries
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_str().is_some_and(is_session_id))
            .filter_map(|entry| read_meta(&entry.path()))
            .collect()
    }

    /// Deletes a session's data folder, as closing it asks (US-3.2.3).
    pub fn remove(&self, session: &SessionId) {
        match std::fs::remove_dir_all(self.session_dir(session)) {
            Err(error) if error.kind() != io::ErrorKind::NotFound => {
                tracing::warn!(session = %session.0, %error, "the session's data folder could not be deleted");
            }
            _ => {}
        }
    }
}

/// The host's boot ID, which changes with every boot; none where the OS has none.
pub fn boot_id() -> Option<String> {
    std::fs::read_to_string("/proc/sys/kernel/random/boot_id")
        .ok()
        .map(|id| id.trim().to_owned())
        .filter(|id| !id.is_empty())
}

fn read_meta(dir: &Path) -> Option<SessionMeta> {
    let read = std::fs::read(dir.join(META_FILE)).map_err(|error| error.to_string());
    let parsed =
        read.and_then(|bytes| serde_json::from_slice::<SessionMeta>(&bytes).map_err(|error| error.to_string()));
    match parsed {
        Ok(meta) if dir.file_name().and_then(|name| name.to_str()) == Some(meta.info.id.0.as_str()) => Some(meta),
        Ok(_) => {
            tracing::warn!(folder = %dir.display(), "a session record names another session");
            None
        }
        Err(error) => {
            tracing::warn!(folder = %dir.display(), %error, "a session record could not be read");
            None
        }
    }
}

/// What of a session's description is worth keeping: not the live process ID or output time.
fn persisted(info: &SessionInfo) -> SessionInfo {
    SessionInfo {
        pid: None,
        last_output_at: None,
        persistence_failure: None,
        ..info.clone()
    }
}

/// A session's record for tests: `/bin/sh`, 80×24, in state `state`, restored after restarts when `restore` holds.
#[cfg(test)]
pub(crate) fn sample_meta(id: &str, order: u32, state: trc_protocol::SessionState, restore: bool) -> SessionMeta {
    use std::collections::BTreeMap;

    use trc_protocol::{Integration, ProfileOrigin, SessionOptions, ShellKind, ShellProfile, TerminalSize};

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
        integration: Integration::Off,
    };
    let size = TerminalSize { cols: 80, rows: 24 };
    let options = SessionOptions {
        restore,
        save_scrollback: true,
    };
    let spec = HolderSpec {
        profile: profile.clone(),
        cwd: None,
        env: BTreeMap::new(),
        size,
        scrollback_lines: 10_000,
        home: "/home/u".into(),
        user: "u".into(),
        options,
        data_dir: None,
    };
    let info = SessionInfo {
        id: SessionId(id.into()),
        custom_name: None,
        title: None,
        order,
        state,
        profile,
        cwd: None,
        size,
        pid: None,
        started_at: None,
        last_output_at: None,
        exit: None,
        failure: None,
        options: Some(options),
        restored: None,
        persistence_failure: None,
    };
    let mut meta = SessionMeta::of(&info, &spec, Some("boot-1"));
    meta.info.state = state;
    meta
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::PermissionsExt;

    use super::*;
    use crate::test_support::temp_dir;

    fn store(label: &str) -> SessionStore {
        let dir = temp_dir(label);
        SessionStore::new(dir, rustix::process::geteuid().as_raw())
    }

    fn sample(id: &str, order: u32) -> SessionMeta {
        sample_meta(id, order, trc_protocol::SessionState::Running, true)
    }

    #[test]
    fn writes_records_only_the_user_can_read_and_reads_them_all_back() {
        let store = store("store-write");
        let (a, b) = (sample("0123456789abcdef", 0), sample("fedcba9876543210", 1));
        store.write(&a).unwrap();
        store.write(&b).unwrap();
        let mut read = store.read_all();
        read.sort_by_key(|meta| meta.info.order);
        assert_eq!(read, vec![a.clone(), b]);
        let mode = |path: &Path| std::fs::metadata(path).unwrap().permissions().mode() & 0o777;
        let folder = store.session_dir(&a.info.id);
        assert_eq!((mode(&folder), mode(&folder.join(META_FILE))), (0o700, 0o600));
        assert!(!folder.join(format!("{META_FILE}.new")).exists());
    }

    #[test]
    fn skips_folders_with_no_record_a_broken_one_or_another_session_s() {
        let store = store("store-skip");
        store.write(&sample("0123456789abcdef", 0)).unwrap();
        let broken = store.prepare(&SessionId("1111111111111111".into())).unwrap();
        std::fs::write(broken.join(META_FILE), b"{ not json").unwrap();
        store.prepare(&SessionId("2222222222222222".into())).unwrap();
        let other = store.prepare(&SessionId("3333333333333333".into())).unwrap();
        let named = serde_json::to_vec(&sample("4444444444444444", 3)).unwrap();
        std::fs::write(other.join(META_FILE), named).unwrap();
        std::fs::create_dir(store.dir.join("not-a-session")).unwrap();
        let ids: Vec<String> = store.read_all().into_iter().map(|meta| meta.info.id.0).collect();
        assert_eq!(ids, vec!["0123456789abcdef".to_owned()]);
    }

    #[test]
    fn keeps_no_live_details_and_deletes_a_folder_on_close() {
        let store = store("store-remove");
        let mut meta = sample("0123456789abcdef", 0);
        meta.info.pid = Some(42);
        meta.info.last_output_at = Some(7);
        let kept = SessionMeta::of(&meta.info, &meta.spec, None);
        assert_eq!((kept.info.pid, kept.info.last_output_at), (None, None));
        store.write(&kept).unwrap();
        store.remove(&kept.info.id);
        assert!(!store.session_dir(&kept.info.id).exists());
    }
}
