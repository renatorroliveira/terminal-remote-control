//! The scripts and where they are written: `<root>/shell-integration/<digest>/`, a private folder per set of
//! scripts, so a holder started by an older daemon keeps reading the scripts it started with.

use std::fmt::Write as _;
use std::io::{self, Write as _};
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::private_dir::ensure_private_dir;

/// Each script, by its path in the scripts' folder.
pub const SCRIPTS: [(&str, &str); 4] = [
    ("bash/trc.bash", include_str!("../../shell-integration/bash/trc.bash")),
    ("zsh/.zshenv", include_str!("../../shell-integration/zsh/.zshenv")),
    (
        "zsh/trc-integration.zsh",
        include_str!("../../shell-integration/zsh/trc-integration.zsh"),
    ),
    (
        "fish/vendor_conf.d/trc.fish",
        include_str!("../../shell-integration/fish/vendor_conf.d/trc.fish"),
    ),
];

/// Writes the scripts under `root`, unless they are there already, and returns their folder. Every folder is 0700 and
/// the user's own (SEC-02), and every file 0600, written through a temporary file so a shell never reads half of one.
pub fn install(root: &Path, uid: u32) -> io::Result<PathBuf> {
    let parent = root.join("shell-integration");
    ensure_private_dir(&parent, uid)?;
    let folder = parent.join(digest());
    ensure_private_dir(&folder, uid)?;
    for (name, text) in SCRIPTS {
        write_script(&folder, name, text)?;
    }
    Ok(folder)
}

/// The first 16 hex digits of the scripts' SHA-256, which names their folder.
pub fn digest() -> String {
    let mut hasher = Sha256::new();
    for (name, text) in SCRIPTS {
        hasher.update(name.as_bytes());
        hasher.update([0]);
        hasher.update(text.as_bytes());
        hasher.update([0]);
    }
    hasher.finalize()[..8].iter().fold(String::new(), |mut hex, byte| {
        let _ = write!(hex, "{byte:02x}");
        hex
    })
}

fn write_script(folder: &Path, name: &str, text: &str) -> io::Result<()> {
    let file = folder.join(name);
    if std::fs::read_to_string(&file).is_ok_and(|kept| kept == text) {
        return Ok(());
    }
    if let Some(parent) = file.parent() {
        std::fs::DirBuilder::new().recursive(true).mode(0o700).create(parent)?;
    }
    let temporary = file.with_extension(format!("{}.new", std::process::id()));
    let written = std::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .mode(0o600)
        .open(&temporary)
        .and_then(|mut handle| handle.write_all(text.as_bytes()))
        .and_then(|()| std::fs::rename(&temporary, &file));
    if written.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    written
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};

    use super::*;

    fn uid() -> u32 {
        rustix::process::geteuid().as_raw()
    }

    fn private_root(label: &str) -> std::path::PathBuf {
        let root = crate::test_support::temp_dir(label);
        std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700)).unwrap();
        root
    }

    #[test]
    fn writes_every_script_privately_once_and_names_the_folder_by_their_digest() {
        let root = private_root("install");
        let folder = install(&root, uid()).unwrap();
        assert_eq!(folder, root.join("shell-integration").join(digest()));
        assert_eq!(digest().len(), 16);
        for (name, text) in SCRIPTS {
            let file = folder.join(name);
            assert_eq!(std::fs::read_to_string(&file).unwrap(), text);
            assert_eq!(std::fs::metadata(&file).unwrap().mode() & 0o777, 0o600, "{name}");
            assert_eq!(
                std::fs::metadata(file.parent().unwrap()).unwrap().mode() & 0o777,
                0o700,
                "{name}"
            );
        }
        let written = std::fs::metadata(folder.join("bash/trc.bash"))
            .unwrap()
            .modified()
            .unwrap();
        assert_eq!(install(&root, uid()).unwrap(), folder);
        let again = std::fs::metadata(folder.join("bash/trc.bash"))
            .unwrap()
            .modified()
            .unwrap();
        assert_eq!(written, again);
    }

    #[test]
    fn puts_a_changed_script_back() {
        let root = private_root("install");
        let folder = install(&root, uid()).unwrap();
        std::fs::write(folder.join("zsh/.zshenv"), "echo changed").unwrap();
        install(&root, uid()).unwrap();
        assert_eq!(
            std::fs::read_to_string(folder.join("zsh/.zshenv")).unwrap(),
            SCRIPTS[1].1
        );
    }
}
