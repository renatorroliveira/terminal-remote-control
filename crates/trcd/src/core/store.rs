//! Every session's `meta.json` in its data folder (TECH_STACK §5.5, SEC-05.1): what the core needs to list it again
//! and start it again after its processes ended (US-3.1.3), written whenever any of that changes. Each write goes to
//! a temporary file that is synced, then renamed over the old one, and the folder is synced. A thread of the store's
//! own does the writing and deleting, in the order asked, so the core's event loop never waits for the disk.

use std::collections::BTreeMap;
use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender, channel, sync_channel};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use trc_protocol::{SessionId, SessionInfo};

use crate::holder::protocol::HolderSpec;
use crate::private_dir::ensure_private_dir;
use crate::session_id::is_session_id;

/// The file's name in a session's data folder.
pub const META_FILE: &str = "meta.json";
const FORMAT: u32 = 1;
/// How long after a failed write the store tries the record again (US-3.1).
const RETRY_AFTER: Duration = Duration::from_secs(10);

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
    /// The user closed the session, so it is deleted rather than brought back, even if the core ends before its
    /// holder does (US-1.10.4).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub closing: bool,
}

impl SessionMeta {
    /// The record of a session as it is now; `closing` when the user closed it.
    pub fn of(info: &SessionInfo, spec: &HolderSpec, boot_id: Option<&str>, closing: bool) -> Self {
        Self {
            format: FORMAT,
            info: persisted(info, spec.options.save_scrollback),
            spec: spec.clone(),
            boot_id: boot_id.map(str::to_owned),
            closing,
        }
    }
}

/// The `meta.json` files under `<root>/sessions`.
pub struct SessionStore {
    dir: PathBuf,
    uid: u32,
    jobs: Option<Sender<Job>>,
    thread: Option<JoinHandle<()>>,
}

enum Job {
    Write(Box<SessionMeta>),
    Remove(SessionId),
    RemoveAll(std::sync::mpsc::SyncSender<io::Result<()>>),
    Flush(std::sync::mpsc::SyncSender<()>),
}

impl SessionStore {
    /// The store of the sessions folder `dir`, whose folders belong to `uid`, with its writing thread.
    pub fn new(dir: PathBuf, uid: u32) -> Self {
        Self::retrying_after(dir, uid, RETRY_AFTER)
    }

    /// The store, trying a write that failed again after `retry_after`.
    fn retrying_after(dir: PathBuf, uid: u32, retry_after: Duration) -> Self {
        let (jobs, receiver) = channel();
        let mut disk = Disk {
            dir: dir.clone(),
            uid,
            failed: BTreeMap::new(),
            retry_after,
            retry_at: None,
        };
        let thread = std::thread::spawn(move || disk.run(&receiver));
        Self {
            dir,
            uid,
            jobs: Some(jobs),
            thread: Some(thread),
        }
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

    /// Reads one session's record, as when a holder that was silent at the core's start introduces itself.
    pub fn read(&self, session: &SessionId) -> Option<SessionMeta> {
        read_meta(&self.session_dir(session))
    }

    /// Has a session's record written; the old one stays whole until the new one has replaced it. A write that
    /// fails is logged.
    pub fn write(&self, meta: &SessionMeta) {
        self.send(Job::Write(Box::new(meta.clone())));
    }

    /// Waits until every write and deletion asked for so far is done.
    pub fn flush(&self) {
        let (done, wait) = sync_channel(1);
        self.send(Job::Flush(done));
        let _ = wait.recv();
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

    /// Deletes the whole `sessions` folder once every write asked for is done, as removing the daemon asks when every
    /// session has ended (US-3.3.3), and waits for it.
    pub fn remove_all(&self) -> io::Result<()> {
        let (done, wait) = sync_channel(1);
        self.send(Job::RemoveAll(done));
        wait.recv()
            .unwrap_or_else(|_| Err(io::Error::other("the session store stopped")))
    }

    /// Has a session's data folder deleted, as closing it asks (US-3.2.3).
    pub fn remove(&self, session: &SessionId) {
        self.send(Job::Remove(session.clone()));
    }

    fn send(&self, job: Job) {
        if let Some(jobs) = &self.jobs {
            let _ = jobs.send(job);
        }
    }
}

impl Drop for SessionStore {
    /// Lets the thread finish every write asked for, so a core that exits leaves every record current.
    fn drop(&mut self) {
        self.jobs = None;
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// The store's writing thread, which tries every record it could not write again after a while, as the core writes
/// a record only when it changes.
struct Disk {
    dir: PathBuf,
    uid: u32,
    failed: BTreeMap<SessionId, SessionMeta>,
    retry_after: Duration,
    /// When the failed records are tried again, however many other jobs arrive meanwhile.
    retry_at: Option<Instant>,
}

impl Disk {
    fn run(&mut self, jobs: &Receiver<Job>) {
        loop {
            let next = match self.retry_at {
                None => jobs.recv().map_err(|_| RecvTimeoutError::Disconnected),
                Some(at) => jobs.recv_timeout(at.saturating_duration_since(Instant::now())),
            };
            match next {
                Ok(job) => self.handle(job),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => return self.retry(),
            }
            if self.retry_at.is_some_and(|at| Instant::now() >= at) {
                self.retry();
            }
        }
    }

    fn handle(&mut self, job: Job) {
        match job {
            Job::Write(meta) => self.write(*meta),
            Job::Remove(session) => {
                self.failed.remove(&session);
                remove_folder(&self.dir.join(&session.0), &session);
            }
            Job::RemoveAll(done) => {
                self.failed.clear();
                let _ = done.send(remove_tree(&self.dir));
            }
            Job::Flush(done) => {
                let _ = done.send(());
            }
        }
    }

    fn retry(&mut self) {
        self.retry_at = None;
        for meta in std::mem::take(&mut self.failed).into_values() {
            self.write(meta);
        }
    }

    /// Writes a record; one that fails is logged the first time and kept to try again.
    fn write(&mut self, meta: SessionMeta) {
        let session = meta.info.id.clone();
        match write_record(&self.dir.join(&session.0), self.uid, &meta) {
            Ok(()) => {
                self.failed.remove(&session);
            }
            Err(error) => {
                if !self.failed.contains_key(&session) {
                    tracing::warn!(session = %session.0, %error, "the session's record could not be saved; retrying");
                }
                self.failed.insert(session, meta);
                self.retry_at.get_or_insert_with(|| Instant::now() + self.retry_after);
            }
        }
    }
}

fn write_record(dir: &Path, uid: u32, meta: &SessionMeta) -> io::Result<()> {
    ensure_private_dir(dir, uid)?;
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
    File::open(dir)?.sync_all()
}

fn remove_folder(dir: &Path, session: &SessionId) {
    if let Err(error) = remove_tree(dir) {
        tracing::warn!(session = %session.0, %error, "the session's data folder could not be deleted");
    }
}

fn remove_tree(dir: &Path) -> io::Result<()> {
    match std::fs::remove_dir_all(dir) {
        Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error),
        _ => Ok(()),
    }
}

/// The host's boot ID, which changes with every boot; none where the OS has none.
pub fn boot_id() -> Option<String> {
    read_boot_id()
        .map(|id| id.trim().to_owned())
        .filter(|id| !id.is_empty())
}
/// Linux's boot ID, which every boot changes.
#[cfg(target_os = "linux")]
fn read_boot_id() -> Option<String> {
    std::fs::read_to_string("/proc/sys/kernel/random/boot_id").ok()
}

/// macOS's boot session UUID, which every boot changes and a logout keeps.
#[cfg(target_os = "macos")]
fn read_boot_id() -> Option<String> {
    let mut buffer = [0_u8; 64];
    let mut length = buffer.len();
    // SAFETY: the name is NUL-terminated, and `buffer` is writable for `length` bytes, which `sysctlbyname` updates
    // to the length it wrote.
    let status = unsafe {
        libc::sysctlbyname(
            c"kern.bootsessionuuid".as_ptr(),
            buffer.as_mut_ptr().cast(),
            &raw mut length,
            std::ptr::null_mut(),
            0,
        )
    };
    let written = buffer.get(..length).filter(|_| status == 0)?;
    std::ffi::CStr::from_bytes_until_nul(written)
        .ok()
        .and_then(|id| id.to_str().ok())
        .map(str::to_owned)
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn read_boot_id() -> Option<String> {
    None
}

fn read_meta(dir: &Path) -> Option<SessionMeta> {
    let read = std::fs::read(dir.join(META_FILE)).map_err(|error| format!("{:?}", error.kind()));
    let parsed =
        read.and_then(|bytes| serde_json::from_slice::<SessionMeta>(&bytes).map_err(|error| parse_problem(&error)));
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

/// Where a record broke, without what it holds, as the log never holds a session's names or environment (SEC-08).
fn parse_problem(error: &serde_json::Error) -> String {
    format!(
        "{:?} at line {} column {}",
        error.classify(),
        error.line(),
        error.column()
    )
}

/// What of a session's description is worth keeping: not the live process ID or output time, nor, for a session
/// that saves nothing to disk, the title its program set, which is output (US-3.2.2).
fn persisted(info: &SessionInfo, saves_output: bool) -> SessionInfo {
    SessionInfo {
        pid: None,
        last_output_at: None,
        persistence_failure: None,
        title: if saves_output { info.title.clone() } else { None },
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
    let mut meta = SessionMeta::of(&info, &spec, Some("boot-1"), false);
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
        store.write(&a);
        store.write(&b);
        store.flush();
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
        store.write(&sample("0123456789abcdef", 0));
        store.flush();
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
        let kept = SessionMeta::of(&meta.info, &meta.spec, None, false);
        assert_eq!((kept.info.pid, kept.info.last_output_at), (None, None));
        store.write(&kept);
        store.remove(&kept.info.id);
        store.flush();
        assert!(!store.session_dir(&kept.info.id).exists());
    }

    #[test]
    fn writes_a_record_again_once_its_folder_can_be_written() {
        let dir = temp_dir("store-retry");
        let store = SessionStore::retrying_after(
            dir.clone(),
            rustix::process::geteuid().as_raw(),
            Duration::from_millis(20),
        );
        let meta = sample("0123456789abcdef", 0);
        let blocker = dir.join(&meta.info.id.0);
        std::fs::write(&blocker, b"not a folder").unwrap();
        store.write(&meta);
        store.flush();
        assert!(store.read_all().is_empty());
        std::fs::remove_file(&blocker).unwrap();
        let started = std::time::Instant::now();
        while store.read_all().is_empty() {
            assert!(
                started.elapsed() < Duration::from_secs(5),
                "the record was never written again"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(store.read_all(), vec![meta]);
    }

    #[test]
    fn writes_a_failed_record_again_while_other_records_keep_arriving() {
        let dir = temp_dir("store-retry-busy");
        let store = SessionStore::retrying_after(
            dir.clone(),
            rustix::process::geteuid().as_raw(),
            Duration::from_millis(100),
        );
        let failed = sample("0123456789abcdef", 0);
        let blocker = dir.join(&failed.info.id.0);
        std::fs::write(&blocker, b"not a folder").unwrap();
        store.write(&failed);
        store.flush();
        std::fs::remove_file(&blocker).unwrap();
        let mut busy = sample("fedcba9876543210", 1);
        let started = std::time::Instant::now();
        while !store.session_dir(&failed.info.id).join(META_FILE).exists() {
            assert!(
                started.elapsed() < Duration::from_secs(5),
                "the failed record waited behind the others"
            );
            busy.info.order += 1;
            store.write(&busy);
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    #[test]
    fn reads_the_id_of_this_boot_from_the_os() {
        let id = boot_id().unwrap_or_default();
        assert_eq!(id.len(), 36, "{id:?}");
        assert_eq!(boot_id().as_deref(), Some(id.as_str()));
    }

    #[test]
    fn keeps_no_title_for_a_session_that_saves_nothing_to_disk() {
        let mut meta = sample("0123456789abcdef", 0);
        meta.info.title = Some("vim secrets.txt".into());
        meta.spec.options.save_scrollback = false;
        assert_eq!(SessionMeta::of(&meta.info, &meta.spec, None, false).info.title, None);
        meta.spec.options.save_scrollback = true;
        assert!(
            SessionMeta::of(&meta.info, &meta.spec, None, false)
                .info
                .title
                .is_some()
        );
    }

    #[test]
    fn logs_where_a_record_broke_without_what_it_holds() {
        let error = serde_json::from_slice::<SessionMeta>(br#"{"format":"secret-value"}"#).unwrap_err();
        assert!(
            !parse_problem(&error).contains("secret-value"),
            "{}",
            parse_problem(&error)
        );
    }
}
