//! Maps Rust target triples to the Zig targets libghostty-vt is built for. Shared by `build.rs` and the tests.

/// Returns the Zig target for a Rust target triple, or `None` when the daemon does not support it. macOS targets name
/// the oldest release the daemon runs on, `MACOSX_DEPLOYMENT_TARGET` in `.cargo/config.toml`, which covers the current
/// and previous two releases (PRD §7.2).
pub fn zig_target(rust_target: &str) -> Option<&'static str> {
    match rust_target {
        "x86_64-unknown-linux-musl" => Some("x86_64-linux-musl"),
        "aarch64-unknown-linux-musl" => Some("aarch64-linux-musl"),
        "x86_64-unknown-linux-gnu" => Some("x86_64-linux-gnu"),
        "aarch64-unknown-linux-gnu" => Some("aarch64-linux-gnu"),
        "aarch64-apple-darwin" => Some("aarch64-macos.13.0"),
        "x86_64-apple-darwin" => Some("x86_64-macos.13.0"),
        _ => None,
    }
}
