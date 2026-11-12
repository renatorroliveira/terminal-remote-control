//! Directories only the user can enter: mode 0700, owned by the user, never a symlink (SEC-02).

use std::io;
use std::os::unix::fs::{DirBuilderExt, MetadataExt};
use std::path::Path;

/// Creates `path` with mode 0700 when it is missing, then verifies it with [`verify_private_dir`].
pub fn ensure_private_dir(path: &Path, uid: u32) -> io::Result<()> {
    match std::fs::DirBuilder::new().mode(0o700).create(path) {
        Err(error) if error.kind() != io::ErrorKind::AlreadyExists => return Err(error),
        _ => {}
    }
    verify_private_dir(path, uid)
}

/// Fails unless `path` is a real directory owned by `uid` that group and others cannot access.
pub fn verify_private_dir(path: &Path, uid: u32) -> io::Result<()> {
    let metadata = std::fs::symlink_metadata(path)?;
    let shown = path.display();
    if !metadata.file_type().is_dir() {
        return Err(io::Error::other(format!("{shown} is not a directory")));
    }
    if metadata.uid() != uid {
        return Err(io::Error::other(format!(
            "{shown} is owned by uid {}, not {uid}",
            metadata.uid()
        )));
    }
    let mode = metadata.mode() & 0o7777;
    if mode & 0o077 != 0 {
        return Err(io::Error::other(format!("{shown} has mode {mode:o}; it must be 700")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};

    use super::*;

    fn uid() -> u32 {
        rustix::process::geteuid().as_raw()
    }

    #[test]
    fn creates_a_missing_directory_with_mode_0700() {
        let dir = crate::test_support::temp_dir("private").join("run");
        ensure_private_dir(&dir, uid()).unwrap();
        assert_eq!(std::fs::metadata(&dir).unwrap().mode() & 0o777, 0o700);
        ensure_private_dir(&dir, uid()).unwrap();
    }

    #[test]
    fn refuses_a_directory_others_can_enter() {
        let dir = crate::test_support::temp_dir("private").join("open");
        std::fs::create_dir(&dir).unwrap();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap();
        let error = ensure_private_dir(&dir, uid()).unwrap_err();
        assert!(error.to_string().contains("mode 755;"), "{error}");
    }

    #[test]
    fn refuses_a_symlink() {
        let base = crate::test_support::temp_dir("private");
        std::fs::create_dir(base.join("real")).unwrap();
        std::os::unix::fs::symlink(base.join("real"), base.join("link")).unwrap();
        let error = verify_private_dir(&base.join("link"), uid()).unwrap_err();
        assert!(error.to_string().contains("not a directory"), "{error}");
    }

    #[test]
    fn refuses_a_directory_of_another_user() {
        let dir = crate::test_support::temp_dir("private").join("theirs");
        ensure_private_dir(&dir, uid()).unwrap();
        let error = verify_private_dir(&dir, uid().wrapping_add(1)).unwrap_err();
        assert!(error.to_string().contains("owned by uid"), "{error}");
    }
}
