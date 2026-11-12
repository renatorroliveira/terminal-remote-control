fn main() {
    let uid = unsafe { libc::getuid() };
    let pw = unsafe { libc::getpwuid(uid) };
    if pw.is_null() {
        println!("uid={uid} getpwuid=NULL shell_env={:?}", std::env::var("SHELL").ok());
    } else {
        let shell = unsafe { std::ffi::CStr::from_ptr((*pw).pw_shell) }.to_string_lossy().into_owned();
        println!("uid={uid} getpwuid shell={shell}");
    }
}
