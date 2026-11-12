//! Raw FFI bindings to libghostty-vt, generated once with bindgen and linked statically.

#[allow(
    missing_docs,
    non_camel_case_types,
    non_upper_case_globals,
    non_snake_case,
    dead_code,
    clippy::all,
    reason = "bindgen output for the libghostty-vt C API"
)]
mod bindings;

pub use bindings::*;

/// The libghostty-vt release these bindings were generated from.
pub const LIBGHOSTTY_VT_VERSION: &str = "1.0.1";

#[cfg(test)]
#[path = "../build/triple.rs"]
mod triple;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn targets_libghostty_vt_1_0_1() {
        assert_eq!(LIBGHOSTTY_VT_VERSION, "1.0.1");
    }

    #[test]
    fn maps_supported_rust_targets_to_zig_targets() {
        assert_eq!(
            triple::zig_target("x86_64-unknown-linux-musl"),
            Some("x86_64-linux-musl")
        );
        assert_eq!(
            triple::zig_target("aarch64-unknown-linux-musl"),
            Some("aarch64-linux-musl")
        );
        assert_eq!(triple::zig_target("aarch64-apple-darwin"), Some("aarch64-macos"));
        assert_eq!(triple::zig_target("x86_64-apple-darwin"), Some("x86_64-macos"));
        assert_eq!(triple::zig_target("x86_64-unknown-linux-gnu"), Some("x86_64-linux-gnu"));
        assert_eq!(
            triple::zig_target("aarch64-unknown-linux-gnu"),
            Some("aarch64-linux-gnu")
        );
        assert_eq!(triple::zig_target("riscv64gc-unknown-linux-gnu"), None);
    }

    #[test]
    fn links_and_runs_the_static_library() {
        let mut terminal: GhosttyTerminal = std::ptr::null_mut();
        // SAFETY: a null allocator selects the default allocator, and `terminal` is a valid out pointer.
        let created = unsafe { ghostty_terminal_new(std::ptr::null(), &mut terminal, 80, 24) };
        assert_eq!(created, GhosttyResult::GHOSTTY_SUCCESS);
        let text = b"hello";
        // SAFETY: `terminal` was created above and `text` outlives the call.
        unsafe { ghostty_terminal_vt_write(terminal, text.as_ptr(), text.len()) };
        let mut cursor_x: u16 = 0;
        // SAFETY: CURSOR_X writes a `u16` through the out pointer.
        let read = unsafe {
            ghostty_terminal_get(
                terminal,
                GhosttyTerminalData::GHOSTTY_TERMINAL_DATA_CURSOR_X,
                (&raw mut cursor_x).cast(),
            )
        };
        assert_eq!((read, cursor_x), (GhosttyResult::GHOSTTY_SUCCESS, 5));
        // SAFETY: `terminal` is not used after this call.
        unsafe { ghostty_terminal_free(terminal) };
    }
}
