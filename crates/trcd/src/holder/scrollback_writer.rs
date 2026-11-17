//! The thread that writes a session's on-disk scrollback, so the holder never waits for the disk (D-04, NFR-08).
//! Appended records are synced to disk at once; a rewrite builds a new file beside the old one and renames it over
//! it, so the file on disk is always whole. A failed write leaves the file as it was before it, and is reported; a
//! rewrite that failed anywhere is thrown away rather than renamed over the file it was to replace.

use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, Sender, channel};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread::JoinHandle;

use trc_protocol::PersistenceFailure;

use super::scrollback_file::FILE_NAME;

/// Appended bytes the writer may have waiting; more means the disk is too slow, and the holder starts over with a
/// rewrite once the queue has drained. It bounds what appending adds to a holder's memory (NFR-09). Rewrites are never
/// dropped, as a rewrite missing a record would lose history; the holder paces them by [`ScrollbackWriter::queued`].
pub const MAX_QUEUED_BYTES: usize = 4 * 1024 * 1024;
const REWRITE_SUFFIX: &str = ".new";

/// Writes one session's scrollback file on its own thread.
pub struct ScrollbackWriter {
    jobs: Option<Sender<Job>>,
    shared: Arc<Mutex<Shared>>,
    thread: Option<JoinHandle<()>>,
}

#[derive(Default)]
struct Shared {
    failure: Option<PersistenceFailure>,
    /// Records were lost, so the file no longer follows the terminal until a rewrite completes.
    stale: bool,
    /// Record bytes sent and not yet written.
    queued: usize,
    /// Appends dropped so far; a rewrite brings the file up to date only if none was dropped after it was finished.
    drops: u64,
    /// Rewrites finished and not yet renamed over the file.
    finishes_queued: usize,
}

enum Job {
    Append(Vec<u8>),
    BeginRewrite,
    RewriteRecord(Vec<u8>),
    /// Replaces the file, sent when `drops` appends had been dropped.
    FinishRewrite(u64),
    Delete,
}

impl ScrollbackWriter {
    /// Starts a writer for the file in `dir`, which keeps its first `keep` bytes: what reading it trusted.
    pub fn open(dir: &Path, keep: u64) -> Self {
        let (jobs, receiver) = channel();
        let shared = Arc::new(Mutex::new(Shared::default()));
        let mut disk = Disk::new(dir, keep, Arc::clone(&shared));
        let thread = std::thread::spawn(move || disk.run(&receiver));
        Self {
            jobs: Some(jobs),
            shared,
            thread: Some(thread),
        }
    }

    /// Appends an encoded record and syncs it to disk; a record the writer has no room for marks the file stale.
    pub fn append(&self, record: Vec<u8>) {
        self.send(Job::Append(record));
    }

    /// Starts a new file that replaces the current one once [`Self::finish_rewrite`] is sent.
    pub fn begin_rewrite(&self) {
        self.send(Job::BeginRewrite);
    }

    /// Adds an encoded record to the new file.
    pub fn rewrite_record(&self, record: Vec<u8>) {
        self.send(Job::RewriteRecord(record));
    }

    /// Syncs the new file and renames it over the current one.
    pub fn finish_rewrite(&self) {
        let drops = self.lock().drops;
        self.send(Job::FinishRewrite(drops));
    }

    /// Deletes the file, as "Save scrollback to disk" turned off asks (US-3.2.2).
    pub fn delete(&self) {
        self.send(Job::Delete);
    }

    /// Deletes the file once every queued write is done, without waiting for the disk: the thread finishes on its
    /// own, and the returned handle says when it has.
    pub fn retire(mut self) -> Retired {
        self.send(Job::Delete);
        self.jobs = None;
        Retired {
            thread: self.thread.take(),
        }
    }

    /// Why the last write failed, until a rewrite succeeds.
    pub fn failure(&self) -> Option<PersistenceFailure> {
        self.lock().failure
    }

    /// Whether records were lost, so only a rewrite brings the file up to date.
    pub fn stale(&self) -> bool {
        self.lock().stale
    }

    /// Record bytes sent and not yet written.
    pub fn queued(&self) -> usize {
        self.lock().queued
    }

    /// Whether a finished rewrite still waits to replace the file, so another would only queue a second copy.
    pub fn rewriting(&self) -> bool {
        self.lock().finishes_queued > 0
    }

    /// Queues a job; an append the writer has no room for is dropped and marks the file stale instead.
    fn send(&self, job: Job) {
        let Some(jobs) = &self.jobs else {
            return;
        };
        let bytes = job.bytes();
        let finish = usize::from(matches!(job, Job::FinishRewrite(_)));
        {
            let mut shared = self.lock();
            if matches!(job, Job::Append(_)) && shared.queued + bytes > MAX_QUEUED_BYTES {
                shared.stale = true;
                shared.drops += 1;
                return;
            }
            shared.queued += bytes;
            shared.finishes_queued += finish;
        }
        if jobs.send(job).is_err() {
            let mut shared = self.lock();
            shared.queued -= bytes;
            shared.finishes_queued -= finish;
            shared.stale = true;
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Shared> {
        self.shared.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// A writer whose disk does nothing until a test says so, as a disk that stopped answering.
#[cfg(test)]
pub struct PausedDisk {
    jobs: Receiver<Job>,
    disk: Disk,
}

#[cfg(test)]
impl PausedDisk {
    /// A writer for the file in `dir`, and the disk side it waits on.
    pub fn writer(dir: &Path) -> (ScrollbackWriter, Self) {
        let (jobs, receiver) = channel();
        let shared = Arc::new(Mutex::new(Shared::default()));
        let disk = Disk::new(dir, 0, Arc::clone(&shared));
        let writer = ScrollbackWriter {
            jobs: Some(jobs),
            shared,
            thread: None,
        };
        (writer, Self { jobs: receiver, disk })
    }

    /// How many rewrites wait to replace the file.
    pub fn rewrites_waiting(&self) -> usize {
        self.disk
            .shared
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .finishes_queued
    }

    /// Does every job sent so far.
    pub fn catch_up(&mut self) {
        while let Ok(job) = self.jobs.try_recv() {
            self.disk.handle(job);
        }
    }
}

impl Drop for ScrollbackWriter {
    /// Lets the thread finish what it was given, so nothing queued is lost when the holder exits.
    fn drop(&mut self) {
        self.jobs = None;
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// A writer that was told to delete the file and stop, finishing on its own.
pub struct Retired {
    thread: Option<JoinHandle<()>>,
}

impl Retired {
    /// Whether the writer has done everything it was given, the deletion last.
    pub fn finished(&self) -> bool {
        self.thread.as_ref().is_none_or(JoinHandle::is_finished)
    }
}

impl Drop for Retired {
    /// Waits for the writer to finish, as a holder that exits must before the core deletes the session's folder.
    fn drop(&mut self) {
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Job {
    fn bytes(&self) -> usize {
        match self {
            Self::Append(record) | Self::RewriteRecord(record) => record.len(),
            Self::BeginRewrite | Self::FinishRewrite(_) | Self::Delete => 0,
        }
    }
}

/// The writer thread's side: the open file and the rewrite in progress.
struct Disk {
    path: PathBuf,
    dir: PathBuf,
    file: Option<File>,
    length: u64,
    rewrite: Option<File>,
    /// A step of the rewrite in progress failed, so it must not replace the file.
    rewrite_failed: bool,
    shared: Arc<Mutex<Shared>>,
}

impl Disk {
    fn new(dir: &Path, keep: u64, shared: Arc<Mutex<Shared>>) -> Self {
        Self {
            path: dir.join(FILE_NAME),
            dir: dir.to_path_buf(),
            file: None,
            length: keep,
            rewrite: None,
            rewrite_failed: false,
            shared,
        }
    }

    fn run(&mut self, jobs: &Receiver<Job>) {
        while let Ok(job) = jobs.recv() {
            self.handle(job);
        }
    }

    fn handle(&mut self, job: Job) {
        let bytes = job.bytes();
        let rewriting = matches!(job, Job::BeginRewrite | Job::RewriteRecord(_));
        let finish = usize::from(matches!(job, Job::FinishRewrite(_)));
        let result = match job {
            Job::Append(record) => self.append(&record),
            Job::BeginRewrite => self.begin_rewrite(),
            Job::RewriteRecord(record) => self.rewrite_record(&record),
            Job::FinishRewrite(drops) => self.finish_rewrite(drops),
            Job::Delete => self.delete(),
        };
        let mut shared = self.shared.lock().unwrap_or_else(PoisonError::into_inner);
        shared.queued = shared.queued.saturating_sub(bytes);
        shared.finishes_queued = shared.finishes_queued.saturating_sub(finish);
        drop(shared);
        if let Err(error) = result {
            tracing::warn!(%error, "the scrollback could not be saved");
            self.rewrite_failed |= rewriting;
            let mut shared = self.shared.lock().unwrap_or_else(PoisonError::into_inner);
            shared.failure = Some(failure_of(&error));
            shared.stale = true;
        }
    }

    /// Appends a record and syncs it; on failure the file is cut back to where it was.
    fn append(&mut self, record: &[u8]) -> io::Result<()> {
        if self.shared.lock().unwrap_or_else(PoisonError::into_inner).stale {
            return Ok(());
        }
        let length = self.length;
        let file = self.file()?;
        let written = file.write_all(record).and_then(|()| file.sync_data());
        if let Err(error) = written {
            let _ = file.set_len(length);
            return Err(error);
        }
        self.length += record.len() as u64;
        Ok(())
    }

    fn begin_rewrite(&mut self) -> io::Result<()> {
        self.rewrite = None;
        self.rewrite_failed = false;
        self.rewrite = Some(create_private(&self.rewrite_path(), true)?);
        Ok(())
    }

    fn rewrite_record(&mut self, record: &[u8]) -> io::Result<()> {
        match &mut self.rewrite {
            Some(file) => file.write_all(record),
            None => Ok(()),
        }
    }

    /// Syncs the new file, renames it over the old one and syncs the folder, so either file is whole after a crash. A
    /// rewrite that failed on the way is deleted instead, and the old file stays, stale, until the next one. The file
    /// stays stale too when an append was dropped after the rewrite was finished, as no file holds that record.
    fn finish_rewrite(&mut self, drops: u64) -> io::Result<()> {
        let Some(file) = self.rewrite.take() else {
            return Ok(());
        };
        if std::mem::take(&mut self.rewrite_failed) {
            drop(file);
            return remove_if_present(&self.rewrite_path());
        }
        file.sync_all()?;
        let length = file.metadata()?.len();
        std::fs::rename(self.rewrite_path(), &self.path)?;
        self.file = None;
        self.length = length;
        File::open(&self.dir)?.sync_all()?;
        let mut shared = self.shared.lock().unwrap_or_else(PoisonError::into_inner);
        shared.failure = None;
        shared.stale = shared.drops != drops;
        Ok(())
    }

    fn delete(&mut self) -> io::Result<()> {
        self.file = None;
        self.rewrite = None;
        self.rewrite_failed = false;
        self.length = 0;
        remove_if_present(&self.path)?;
        remove_if_present(&self.rewrite_path())
    }

    /// The open file, opened for appending after its trusted bytes, created 0600 when missing.
    fn file(&mut self) -> io::Result<&mut File> {
        if self.file.is_none() {
            let file = create_private(&self.path, false)?;
            file.set_len(self.length)?;
            self.file = Some(file);
        }
        self.file
            .as_mut()
            .ok_or_else(|| io::Error::other("the scrollback file is not open"))
    }

    fn rewrite_path(&self) -> PathBuf {
        let mut name = self.path.clone().into_os_string();
        name.push(REWRITE_SUFFIX);
        PathBuf::from(name)
    }
}

fn remove_if_present(path: &Path) -> io::Result<()> {
    match std::fs::remove_file(path) {
        Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error),
        _ => Ok(()),
    }
}

/// Opens `path` for appending, mode 0600, never following a symlink a planted file could be; `truncate` empties it.
fn create_private(path: &Path, truncate: bool) -> io::Result<File> {
    OpenOptions::new()
        .create(true)
        .append(!truncate)
        .write(true)
        .truncate(truncate)
        .mode(0o600)
        .custom_flags(rustix::fs::OFlags::NOFOLLOW.bits().cast_signed())
        .open(path)
}

/// What a failed write tells the user (US-3.1.2).
fn failure_of(error: &io::Error) -> PersistenceFailure {
    match error.raw_os_error().map(rustix::io::Errno::from_raw_os_error) {
        Some(rustix::io::Errno::NOSPC) => PersistenceFailure::DiskFull,
        Some(rustix::io::Errno::DQUOT) => PersistenceFailure::Quota,
        Some(rustix::io::Errno::ROFS) => PersistenceFailure::ReadOnly,
        _ => PersistenceFailure::Other,
    }
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::PermissionsExt;

    use super::*;
    use crate::holder::scrollback_file::{Record, encode, read};
    use crate::test_support::temp_dir;

    fn record(history: &[u8], screen: Option<&[u8]>) -> Vec<u8> {
        encode(Record { history, screen })
    }

    fn history_in(dir: &Path) -> (Vec<u8>, Option<Vec<u8>>) {
        let file = File::open(dir.join(FILE_NAME)).unwrap();
        let mut history = Vec::new();
        let recovered = read(file, |past| history.extend_from_slice(past)).unwrap();
        (history, recovered.screen)
    }

    #[test]
    fn stays_stale_when_a_record_was_dropped_after_the_rewrite_that_would_have_held_it() {
        let dir = temp_dir("writer-drop-after-rewrite");
        let (writer, mut disk) = PausedDisk::writer(&dir);
        writer.begin_rewrite();
        writer.rewrite_record(record(b"old\r\n", None));
        writer.finish_rewrite();
        writer.append(vec![0; MAX_QUEUED_BYTES]);
        assert!(writer.stale());
        disk.catch_up();
        assert!(writer.stale(), "the dropped record is in no file");
    }

    #[test]
    fn appends_records_to_a_file_only_the_user_can_read() {
        let dir = temp_dir("writer-append");
        let writer = ScrollbackWriter::open(&dir, 0);
        writer.append(record(b"one\r\n", Some(b"screen")));
        writer.append(record(b"two\r\n", None));
        drop(writer);
        assert_eq!(history_in(&dir), (b"one\r\ntwo\r\n".to_vec(), Some(b"screen".to_vec())));
        let mode = std::fs::metadata(dir.join(FILE_NAME)).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    #[test]
    fn cuts_off_what_reading_did_not_trust_before_it_appends() {
        let dir = temp_dir("writer-keep");
        let good = record(b"kept\r\n", None);
        std::fs::write(dir.join(FILE_NAME), [&good[..], b"torn"].concat()).unwrap();
        let writer = ScrollbackWriter::open(&dir, good.len() as u64);
        writer.append(record(b"next\r\n", None));
        drop(writer);
        assert_eq!(history_in(&dir).0, b"kept\r\nnext\r\n");
    }

    #[test]
    fn replaces_the_file_whole_when_a_rewrite_finishes() {
        let dir = temp_dir("writer-rewrite");
        let writer = ScrollbackWriter::open(&dir, 0);
        writer.append(record(b"old\r\n", Some(b"old screen")));
        writer.begin_rewrite();
        writer.rewrite_record(record(b"new\r\n", None));
        writer.rewrite_record(record(b"", Some(b"new screen")));
        writer.finish_rewrite();
        writer.append(record(b"after\r\n", None));
        drop(writer);
        assert_eq!(
            history_in(&dir),
            (b"new\r\nafter\r\n".to_vec(), Some(b"new screen".to_vec()))
        );
        assert!(!dir.join(format!("{FILE_NAME}{REWRITE_SUFFIX}")).exists());
    }

    #[test]
    fn deletes_the_file_and_starts_over_after() {
        let dir = temp_dir("writer-delete");
        let writer = ScrollbackWriter::open(&dir, 0);
        writer.append(record(b"secret\r\n", None));
        writer.delete();
        drop(writer);
        assert!(!dir.join(FILE_NAME).exists());
    }

    #[test]
    fn reports_a_failed_write_and_waits_for_a_rewrite() {
        let dir = temp_dir("writer-fail");
        std::fs::create_dir(dir.join(FILE_NAME)).unwrap();
        let writer = ScrollbackWriter::open(&dir, 0);
        writer.append(record(b"lost\r\n", None));
        while writer.failure().is_none() {
            std::thread::yield_now();
        }
        assert_eq!(writer.failure(), Some(PersistenceFailure::Other));
        assert!(writer.stale());
        std::fs::remove_dir(dir.join(FILE_NAME)).unwrap();
        writer.append(record(b"skipped\r\n", None));
        writer.begin_rewrite();
        writer.rewrite_record(record(b"whole\r\n", None));
        writer.finish_rewrite();
        drop(writer);
        assert_eq!(history_in(&dir).0, b"whole\r\n");
    }

    #[test]
    fn throws_away_a_rewrite_that_failed_and_keeps_the_old_file() {
        let dir = temp_dir("writer-failed-rewrite");
        let old = record(b"old\r\n", Some(b"old screen"));
        std::fs::write(dir.join(FILE_NAME), &old).unwrap();
        let shared = Arc::new(Mutex::new(Shared::default()));
        let mut disk = Disk {
            path: dir.join(FILE_NAME),
            dir: dir.clone(),
            file: None,
            length: old.len() as u64,
            rewrite: None,
            rewrite_failed: false,
            shared: Arc::clone(&shared),
        };
        disk.handle(Job::BeginRewrite);
        disk.rewrite = Some(File::open(dir.join(FILE_NAME)).unwrap());
        disk.handle(Job::RewriteRecord(record(b"new\r\n", None)));
        disk.handle(Job::FinishRewrite(0));
        assert_eq!(history_in(&dir), (b"old\r\n".to_vec(), Some(b"old screen".to_vec())));
        assert!(!dir.join(format!("{FILE_NAME}{REWRITE_SUFFIX}")).exists());
        let shared = shared.lock().unwrap();
        assert!(shared.stale && shared.failure.is_some());
    }

    #[test]
    fn never_drops_a_rewrite_record_however_much_waits() {
        let dir = temp_dir("writer-large-rewrite");
        let writer = ScrollbackWriter::open(&dir, 0);
        let big = vec![b'x'; MAX_QUEUED_BYTES / 2];
        writer.begin_rewrite();
        for _ in 0..4 {
            writer.rewrite_record(record(&big, None));
        }
        writer.rewrite_record(record(b"", Some(b"screen")));
        writer.finish_rewrite();
        drop(writer);
        let (history, screen) = history_in(&dir);
        assert_eq!((history.len(), screen), (big.len() * 4, Some(b"screen".to_vec())));
    }

    #[test]
    fn names_a_full_disk_a_used_up_quota_and_a_read_only_file_system() {
        let errno = |code: rustix::io::Errno| failure_of(&io::Error::from_raw_os_error(code.raw_os_error()));
        assert_eq!(errno(rustix::io::Errno::NOSPC), PersistenceFailure::DiskFull);
        assert_eq!(errno(rustix::io::Errno::DQUOT), PersistenceFailure::Quota);
        assert_eq!(errno(rustix::io::Errno::ROFS), PersistenceFailure::ReadOnly);
        assert_eq!(errno(rustix::io::Errno::IO), PersistenceFailure::Other);
    }
}
