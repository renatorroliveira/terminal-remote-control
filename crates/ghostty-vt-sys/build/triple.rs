//! Maps Rust target triples to the Zig targets libghostty-vt is built for. Shared by `build.rs` and the tests.

/// Returns the Zig target for a Rust target triple, or `None` when the daemon does not support it.
pub fn zig_target(rust_target: &str) -> Option<&'static str> {
    match rust_target {
        "x86_64-unknown-linux-musl" => Some("x86_64-linux-musl"),
        "aarch64-unknown-linux-musl" => Some("aarch64-linux-musl"),
        "x86_64-unknown-linux-gnu" => Some("x86_64-linux-gnu"),
        "aarch64-unknown-linux-gnu" => Some("aarch64-linux-gnu"),
        "aarch64-apple-darwin" => Some("aarch64-macos"),
        "x86_64-apple-darwin" => Some("x86_64-macos"),
        _ => None,
    }
}
