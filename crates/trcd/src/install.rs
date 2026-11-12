//! The install layout `<root>/versions/<version>/trcd` and the integrity check every subcommand runs first (SEC-04.4).

use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};

use thiserror::Error;

/// Where the running binary sits inside its install root.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstallLayout {
    /// The install root, `~/.trc` by default.
    pub root: PathBuf,
    /// `<root>/versions`.
    pub versions: PathBuf,
    /// `<root>/versions/<version>`.
    pub version_dir: PathBuf,
    /// The binary itself.
    pub binary: PathBuf,
}

/// Why the install cannot be trusted.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum InstallError {
    /// The binary is not at `<root>/versions/<version>/trcd`.
    #[error("{0} is not inside an install root (<root>/versions/<version>/trcd)")]
    Layout(String),
    /// A path belongs to another user.
    #[error("{path} is owned by uid {owner}, not {expected}")]
    ForeignOwner {
        /// The offending path.
        path: String,
        /// Its owner.
        owner: u32,
        /// The user running `trcd`.
        expected: u32,
    },
    /// A path is writable by group or others.
    #[error("{path} is writable by group or others (mode {mode:o})")]
    Writable {
        /// The offending path.
        path: String,
        /// Its permission bits.
        mode: u32,
    },
    /// A path could not be examined.
    #[error("{path}: {reason}")]
    Unreadable {
        /// The offending path.
        path: String,
        /// The OS error.
        reason: String,
    },
}

impl InstallLayout {
    /// The layout of the running executable.
    pub fn current() -> Result<Self, InstallError> {
        let unreadable = |error: std::io::Error| InstallError::Unreadable {
            path: "trcd".into(),
            reason: error.to_string(),
        };
        let binary = std::env::current_exe()
            .and_then(std::fs::canonicalize)
            .map_err(unreadable)?;
        Self::from_binary(&binary)
    }

    /// The layout around `binary`, which must be `<root>/versions/<version>/<file>`.
    pub fn from_binary(binary: &Path) -> Result<Self, InstallError> {
        let layout_error = || InstallError::Layout(binary.display().to_string());
        let version_dir = binary
            .parent()
            .filter(|dir| dir.file_name().is_some())
            .ok_or_else(layout_error)?;
        let versions = version_dir
            .parent()
            .filter(|dir| dir.ends_with("versions"))
            .ok_or_else(layout_error)?;
        let root = versions
            .parent()
            .filter(|dir| dir.file_name().is_some())
            .ok_or_else(layout_error)?;
        Ok(Self {
            root: root.to_path_buf(),
            versions: versions.to_path_buf(),
            version_dir: version_dir.to_path_buf(),
            binary: binary.to_path_buf(),
        })
    }

    /// Fails when the binary, its version directory, `versions` or the root is owned by anyone but `uid` or is
    /// writable by group or others.
    pub fn check_integrity(&self, uid: u32) -> Result<(), InstallError> {
        [&self.binary, &self.version_dir, &self.versions, &self.root]
            .into_iter()
            .try_for_each(|path| check_owned_and_protected(path, uid))
    }

    /// Where the core writes its logs.
    pub fn logs_dir(&self) -> PathBuf {
        self.root.join("logs")
    }
}

fn check_owned_and_protected(path: &Path, uid: u32) -> Result<(), InstallError> {
    let shown = path.display().to_string();
    let metadata = std::fs::symlink_metadata(path).map_err(|error| InstallError::Unreadable {
        path: shown.clone(),
        reason: error.to_string(),
    })?;
    if metadata.uid() != uid {
        return Err(InstallError::ForeignOwner {
            path: shown,
            owner: metadata.uid(),
            expected: uid,
        });
    }
    let mode = metadata.mode() & 0o7777;
    if mode & 0o022 != 0 {
        return Err(InstallError::Writable { path: shown, mode });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::{DirBuilderExt, PermissionsExt};

    use super::*;

    fn installed(mode: u32) -> InstallLayout {
        let base = crate::test_support::temp_dir("install");
        let version_dir = base.join("root/versions/0123");
        std::fs::DirBuilder::new()
            .mode(0o700)
            .recursive(true)
            .create(&version_dir)
            .unwrap();
        let binary = version_dir.join("trcd");
        std::fs::write(&binary, b"#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(mode)).unwrap();
        InstallLayout::from_binary(&binary).unwrap()
    }

    #[test]
    fn derives_the_root_from_the_binary_path() {
        let layout = InstallLayout::from_binary(Path::new("/home/u/.trc/versions/abc/trcd")).unwrap();
        assert_eq!(layout.root, Path::new("/home/u/.trc"));
        assert_eq!(layout.versions, Path::new("/home/u/.trc/versions"));
        assert_eq!(layout.version_dir, Path::new("/home/u/.trc/versions/abc"));
        assert_eq!(layout.logs_dir(), Path::new("/home/u/.trc/logs"));
    }

    #[test]
    fn rejects_a_binary_outside_an_install_root() {
        for path in ["/usr/local/bin/trcd", "/trcd", "/home/u/.trc/other/abc/trcd"] {
            assert_eq!(
                InstallLayout::from_binary(Path::new(path)),
                Err(InstallError::Layout(path.into()))
            );
        }
    }

    #[test]
    fn accepts_an_install_owned_by_the_user() {
        let uid = rustix::process::geteuid().as_raw();
        assert_eq!(installed(0o700).check_integrity(uid), Ok(()));
        assert_eq!(installed(0o755).check_integrity(uid), Ok(()));
    }

    #[test]
    fn rejects_a_binary_writable_by_others() {
        let layout = installed(0o722);
        let uid = rustix::process::geteuid().as_raw();
        let expected = InstallError::Writable {
            path: layout.binary.display().to_string(),
            mode: 0o722,
        };
        assert_eq!(layout.check_integrity(uid), Err(expected));
    }

    #[test]
    fn rejects_a_group_writable_version_directory() {
        let layout = installed(0o700);
        std::fs::set_permissions(&layout.version_dir, std::fs::Permissions::from_mode(0o770)).unwrap();
        let uid = rustix::process::geteuid().as_raw();
        let expected = InstallError::Writable {
            path: layout.version_dir.display().to_string(),
            mode: 0o770,
        };
        assert_eq!(layout.check_integrity(uid), Err(expected));
    }

    #[test]
    fn rejects_an_install_owned_by_someone_else() {
        let layout = installed(0o700);
        let uid = rustix::process::geteuid().as_raw();
        let other = uid.wrapping_add(1);
        let expected = InstallError::ForeignOwner {
            path: layout.binary.display().to_string(),
            owner: uid,
            expected: other,
        };
        assert_eq!(layout.check_integrity(other), Err(expected));
    }
}
