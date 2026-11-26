//! User-only folders on Windows (SEC-02, SEC-05, D-68): a protected DACL that grants full control to the current user's
//! SID alone, inherited by everything inside, and the not-content-indexed attribute, so Windows Search keeps no copy
//! of state files or scrollback. `trcd private-dir <folder>` applies it for the app.

use std::ffi::c_void;
use std::io;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use std::ptr::{null, null_mut};

use windows_sys::Win32::Foundation::{CloseHandle, ERROR_SUCCESS, HANDLE, HLOCAL, LocalFree};
use windows_sys::Win32::Security::Authorization::{GetNamedSecurityInfoW, SE_FILE_OBJECT, SetNamedSecurityInfoW};
use windows_sys::Win32::Security::{
    ACCESS_ALLOWED_ACE, ACE_HEADER, ACL, ACL_REVISION, ACL_SIZE_INFORMATION, AclSizeInformation, AddAccessAllowedAceEx,
    CONTAINER_INHERIT_ACE, DACL_SECURITY_INFORMATION, EqualSid, GetAce, GetAclInformation, GetLengthSid,
    GetSecurityDescriptorControl, GetTokenInformation, InitializeAcl, OBJECT_INHERIT_ACE,
    PROTECTED_DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, SE_DACL_PROTECTED, TOKEN_QUERY, TOKEN_USER, TokenUser,
};
use windows_sys::Win32::Storage::FileSystem::{
    FILE_ALL_ACCESS, FILE_ATTRIBUTE_NOT_CONTENT_INDEXED, GetFileAttributesW, INVALID_FILE_ATTRIBUTES,
    SetFileAttributesW,
};
use windows_sys::Win32::System::SystemServices::ACCESS_ALLOWED_ACE_TYPE;
use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

/// Makes the folder at `path` private unless it already is, as a check at every launch should cost nothing when
/// nothing changed: returns whether it had to change anything.
pub fn ensure_private(path: &Path) -> io::Result<bool> {
    if is_private(path)? && not_indexed(&wide(path))? {
        return Ok(false);
    }
    make_private(path)?;
    Ok(true)
}

/// Gives the folder at `path` a protected DACL that grants full control to the current user alone, inherited by
/// every file and folder inside, and marks it and everything already inside not content indexed. Links inside are
/// left alone, so nothing outside the folder changes.
pub fn make_private(path: &Path) -> io::Result<()> {
    let user = CurrentUser::query()?;
    let mut acl = user_only_acl(&user)?;
    let name = wide(path);
    // SAFETY: `name` is NUL-terminated, `acl` is an initialized ACL that outlives the call, and no owner, group or
    // SACL is passed.
    let status = unsafe {
        SetNamedSecurityInfoW(
            name.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
            null_mut(),
            null_mut(),
            acl.as_mut_ptr().cast::<ACL>(),
            null(),
        )
    };
    if status != ERROR_SUCCESS {
        return Err(io::Error::from_raw_os_error(status as i32));
    }
    mark_tree_not_indexed(path)?;
    mark_not_indexed(&name)
}

/// Marks everything inside `folder` not content indexed, as far as it can: a child that vanished meanwhile is
/// skipped, and any other failure stops only its own subtree and is returned once the rest is marked. The folder
/// itself is marked only after a complete pass, so [`ensure_private`] tries again after a failed one.
fn mark_tree_not_indexed(folder: &Path) -> io::Result<()> {
    let mut first = None;
    for entry in std::fs::read_dir(folder)? {
        if let Err(error) = entry.and_then(|entry| mark_entry(&entry))
            && error.kind() != io::ErrorKind::NotFound
        {
            first.get_or_insert(error);
        }
    }
    first.map_or(Ok(()), Err)
}

fn mark_entry(entry: &std::fs::DirEntry) -> io::Result<()> {
    let kind = entry.file_type()?;
    if kind.is_symlink() {
        return Ok(());
    }
    mark_not_indexed(&wide(&entry.path()))?;
    if kind.is_dir() {
        mark_tree_not_indexed(&entry.path())?;
    }
    Ok(())
}

fn not_indexed(name: &[u16]) -> io::Result<bool> {
    // SAFETY: `name` is NUL-terminated.
    let attributes = unsafe { GetFileAttributesW(name.as_ptr()) };
    if attributes == INVALID_FILE_ATTRIBUTES {
        return Err(io::Error::last_os_error());
    }
    Ok(attributes & FILE_ATTRIBUTE_NOT_CONTENT_INDEXED != 0)
}

/// Whether the DACL of `path` is protected from inheritance and grants access to the current user's SID alone.
pub fn is_private(path: &Path) -> io::Result<bool> {
    let user = CurrentUser::query()?;
    let name = wide(path);
    let mut dacl: *mut ACL = null_mut();
    let mut descriptor: PSECURITY_DESCRIPTOR = null_mut();
    // SAFETY: `name` is NUL-terminated and the out-pointers are valid; the descriptor is freed below.
    let status = unsafe {
        GetNamedSecurityInfoW(
            name.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            null_mut(),
            null_mut(),
            &raw mut dacl,
            null_mut(),
            &raw mut descriptor,
        )
    };
    if status != ERROR_SUCCESS {
        return Err(io::Error::from_raw_os_error(status as i32));
    }
    let private = protected(descriptor) && !dacl.is_null() && grants_only(dacl, user.sid());
    // SAFETY: `descriptor` was allocated by GetNamedSecurityInfoW, which asks for LocalFree.
    unsafe { LocalFree(descriptor as HLOCAL) };
    Ok(private)
}

/// The current process's user, from its token.
struct CurrentUser {
    /// The `TOKEN_USER` structure, whose SID points into this buffer.
    buffer: Vec<u64>,
}

impl CurrentUser {
    fn query() -> io::Result<Self> {
        let token = ProcessToken::open()?;
        let mut length = 0_u32;
        // SAFETY: a null buffer of length 0 asks only for the size needed.
        unsafe { GetTokenInformation(token.0, TokenUser, null_mut(), 0, &raw mut length) };
        let mut buffer = vec![0_u64; (length as usize).div_ceil(size_of::<u64>())];
        // SAFETY: `buffer` holds at least `length` bytes, aligned for TOKEN_USER.
        let ok = unsafe {
            GetTokenInformation(
                token.0,
                TokenUser,
                buffer.as_mut_ptr().cast::<c_void>(),
                length,
                &raw mut length,
            )
        };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(Self { buffer })
    }

    fn sid(&self) -> *mut c_void {
        // SAFETY: the buffer holds the TOKEN_USER GetTokenInformation wrote.
        unsafe { (*self.buffer.as_ptr().cast::<TOKEN_USER>()).User.Sid }
    }
}

/// A process token handle, closed when dropped.
struct ProcessToken(HANDLE);

impl ProcessToken {
    fn open() -> io::Result<Self> {
        let mut handle: HANDLE = null_mut();
        // SAFETY: the pseudo-handle of the current process needs no closing, and `handle` is a valid out-pointer.
        if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &raw mut handle) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(Self(handle))
    }
}

impl Drop for ProcessToken {
    fn drop(&mut self) {
        // SAFETY: the handle came from OpenProcessToken and is closed once.
        unsafe { CloseHandle(self.0) };
    }
}

/// An ACL with one inheritable ACE granting `user` full control, in a buffer aligned for `ACL`.
fn user_only_acl(user: &CurrentUser) -> io::Result<Vec<u32>> {
    // SAFETY: the SID is valid while `user` lives.
    let sid_length = unsafe { GetLengthSid(user.sid()) } as usize;
    let size = size_of::<ACL>() + size_of::<ACCESS_ALLOWED_ACE>() - size_of::<u32>() + sid_length;
    let mut acl = vec![0_u32; size.div_ceil(size_of::<u32>())];
    let acl_pointer = acl.as_mut_ptr().cast::<ACL>();
    let length = u32::try_from(acl.len() * size_of::<u32>()).map_err(io::Error::other)?;
    // SAFETY: `acl` holds `length` bytes, enough for the header and one ACE with this SID.
    let ok = unsafe {
        InitializeAcl(acl_pointer, length, ACL_REVISION) != 0
            && AddAccessAllowedAceEx(
                acl_pointer,
                ACL_REVISION,
                OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE,
                FILE_ALL_ACCESS,
                user.sid(),
            ) != 0
    };
    if !ok {
        return Err(io::Error::last_os_error());
    }
    Ok(acl)
}

fn mark_not_indexed(name: &[u16]) -> io::Result<()> {
    // SAFETY: `name` is NUL-terminated.
    let attributes = unsafe { GetFileAttributesW(name.as_ptr()) };
    if attributes == INVALID_FILE_ATTRIBUTES {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: `name` is NUL-terminated.
    if unsafe { SetFileAttributesW(name.as_ptr(), attributes | FILE_ATTRIBUTE_NOT_CONTENT_INDEXED) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

fn protected(descriptor: PSECURITY_DESCRIPTOR) -> bool {
    let mut control = 0_u16;
    let mut revision = 0_u32;
    // SAFETY: `descriptor` is a valid security descriptor and the out-pointers are valid.
    let ok = unsafe { GetSecurityDescriptorControl(descriptor, &raw mut control, &raw mut revision) };
    ok != 0 && control & SE_DACL_PROTECTED != 0
}

fn grants_only(dacl: *const ACL, user: *mut c_void) -> bool {
    let mut size = ACL_SIZE_INFORMATION {
        AceCount: 0,
        AclBytesInUse: 0,
        AclBytesFree: 0,
    };
    let length = size_of::<ACL_SIZE_INFORMATION>() as u32;
    // SAFETY: `dacl` is a valid ACL and `size` is the structure AclSizeInformation fills.
    let ok = unsafe { GetAclInformation(dacl, (&raw mut size).cast::<c_void>(), length, AclSizeInformation) };
    ok != 0 && size.AceCount > 0 && (0..size.AceCount).all(|index| ace_grants(dacl, index, user))
}

fn ace_grants(dacl: *const ACL, index: u32, user: *mut c_void) -> bool {
    let mut ace: *mut c_void = null_mut();
    // SAFETY: `index` is below the ACL's ACE count, and `ace` points into the ACL afterwards.
    if unsafe { GetAce(dacl, index, &raw mut ace) } == 0 {
        return false;
    }
    // SAFETY: every ACE starts with an ACE_HEADER.
    let header = unsafe { *ace.cast::<ACE_HEADER>() };
    let inherited = OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE;
    if u32::from(header.AceType) != ACCESS_ALLOWED_ACE_TYPE || u32::from(header.AceFlags) & inherited != inherited {
        return false;
    }
    let allowed = ace.cast::<ACCESS_ALLOWED_ACE>();
    // SAFETY: an access-allowed ACE holds its mask after the header.
    if unsafe { (*allowed).Mask } != FILE_ALL_ACCESS {
        return false;
    }
    // SAFETY: an access-allowed ACE's SID starts at `SidStart`.
    let sid = unsafe { (&raw mut (*allowed).SidStart).cast::<c_void>() };
    // SAFETY: both SIDs are valid.
    unsafe { EqualSid(sid, user) != 0 }
}

fn wide(path: &Path) -> Vec<u16> {
    path.as_os_str().encode_wide().chain(Some(0)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_folder_inherits_more_than_the_user() {
        let folder = crate::test_support::temp_dir("acl-inherited");
        assert!(!is_private(&folder).unwrap());
    }

    #[test]
    fn make_private_leaves_only_the_user_and_marks_the_folder_not_indexed() {
        let folder = crate::test_support::temp_dir("acl-private");
        std::fs::write(folder.join("before"), b"x").unwrap();
        make_private(&folder).unwrap();
        std::fs::write(folder.join("after"), b"x").unwrap();
        assert!(is_private(&folder).unwrap());
        assert!(not_indexed(&wide(&folder)).unwrap());
    }

    #[test]
    fn make_private_marks_what_was_already_inside_not_indexed() {
        let folder = crate::test_support::temp_dir("acl-indexed");
        std::fs::create_dir(folder.join("logs")).unwrap();
        std::fs::write(folder.join("logs").join("old.log"), b"x").unwrap();
        std::fs::write(folder.join("config.json"), b"{}").unwrap();
        make_private(&folder).unwrap();
        for inside in ["logs", "logs/old.log", "config.json"] {
            assert!(not_indexed(&wide(&folder.join(inside))).unwrap(), "{inside}");
        }
    }

    #[test]
    fn a_child_it_cannot_mark_leaves_the_folder_to_be_tried_again() {
        let folder = crate::test_support::temp_dir("acl-retry");
        let locked = folder.join("locked.txt");
        std::fs::write(&locked, b"x").unwrap();
        std::fs::write(folder.join("other.txt"), b"x").unwrap();
        let user = std::env::var("USERNAME").unwrap();
        let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
        let icacls_exe = std::path::Path::new(&system_root).join("System32").join("icacls.exe");
        let icacls = |change: &str, rule: String| {
            let status = std::process::Command::new(&icacls_exe)
                .arg(&locked)
                .args([change, &rule])
                .status()
                .unwrap();
            assert!(status.success(), "icacls {change} {rule}");
        };
        icacls("/deny", format!("{user}:(WA)"));
        assert!(ensure_private(&folder).is_err());
        assert!(!not_indexed(&wide(&folder)).unwrap());
        assert!(not_indexed(&wide(&folder.join("other.txt"))).unwrap());
        icacls("/remove:d", user);
        assert!(ensure_private(&folder).unwrap());
        assert!(not_indexed(&wide(&locked)).unwrap());
    }

    #[test]
    fn ensure_private_changes_a_folder_once() {
        let folder = crate::test_support::temp_dir("acl-ensure");
        assert!(ensure_private(&folder).unwrap());
        assert!(!ensure_private(&folder).unwrap());
        assert!(is_private(&folder).unwrap());
    }
}
