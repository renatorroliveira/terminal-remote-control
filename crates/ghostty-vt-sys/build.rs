//! Builds libghostty-vt from the source that `tools/fetch-libghostty.sh` verified, for the current target, and links
//! it statically. Never touches the network (TECH_STACK D-14). Each version and target is built once and cached.

#[path = "build/triple.rs"]
mod triple;

use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    let manifest = read_manifest();
    let version = manifest_value(&manifest, "version");
    let target = std::env::var("TARGET").expect("cargo sets TARGET");
    let zig_target =
        triple::zig_target(&target).unwrap_or_else(|| panic!("libghostty-vt is not built for target {target}"));
    let cache = cache_dir().join("libghostty-vt").join(&version);
    let library = cached_library(&cache, &version, zig_target);
    let out = PathBuf::from(std::env::var("OUT_DIR").expect("cargo sets OUT_DIR")).join("lib");
    std::fs::create_dir_all(&out).expect("create OUT_DIR/lib");
    std::fs::copy(&library, out.join("libghostty-vt.a")).expect("copy libghostty-vt.a");
    println!("cargo:rustc-link-search=native={}", out.display());
    println!("cargo:rustc-link-lib=static=ghostty-vt");
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=build/triple.rs");
    println!("cargo:rerun-if-changed=../../tools/libghostty.manifest");
    println!("cargo:rerun-if-env-changed=TRC_CACHE_DIR");
    println!("cargo:rerun-if-env-changed=ZIG");
}

fn read_manifest() -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tools/libghostty.manifest");
    std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("read {}: {error}", path.display()))
}

fn manifest_value(manifest: &str, key: &str) -> String {
    manifest
        .lines()
        .find_map(|line| line.strip_prefix(key)?.strip_prefix('='))
        .unwrap_or_else(|| panic!("tools/libghostty.manifest has no {key}"))
        .trim()
        .to_owned()
}

fn cache_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("TRC_CACHE_DIR") {
        return PathBuf::from(dir);
    }
    if let Some(dir) = std::env::var_os("XDG_CACHE_HOME") {
        return PathBuf::from(dir).join("trc");
    }
    PathBuf::from(std::env::var_os("HOME").expect("HOME is set")).join(".cache/trc")
}

fn cached_library(cache: &Path, version: &str, zig_target: &str) -> PathBuf {
    let built = cache.join("build").join(zig_target);
    let library = built.join("lib/libghostty-vt.a");
    if library.is_file() {
        return library;
    }
    let source = cache.join("src").join(format!("libghostty-vt-{version}"));
    let deps = cache.join("src").join(format!("libghostty-vt-{version}-deps"));
    assert!(
        cache.join("verified").is_file() && source.is_dir() && deps.is_dir(),
        "libghostty-vt {version} is not fetched; run tools/fetch-libghostty.sh"
    );
    let staging = cache.join("build").join(format!("{zig_target}.{}", std::process::id()));
    let zig_cache = staging.join("zig-cache");
    std::fs::create_dir_all(&zig_cache).expect("create the zig cache directory");
    let zig = std::env::var("ZIG").unwrap_or_else(|_| "zig".into());
    let status = Command::new(&zig)
        .current_dir(&source)
        .env("ZIG_GLOBAL_CACHE_DIR", &zig_cache)
        .args(["build", "--prefix"])
        .arg(staging.join("prefix"))
        .arg("--system")
        .arg(&deps)
        .args(["-Doptimize=ReleaseFast", "-Dcpu=baseline"])
        .arg(format!("-Dtarget={zig_target}"))
        .status()
        .unwrap_or_else(|error| panic!("run {zig}: {error} (install Zig 0.17)"));
    assert!(status.success(), "zig build of libghostty-vt for {zig_target} failed");
    std::fs::create_dir_all(built.join("lib")).expect("create the build directory");
    std::fs::rename(staging.join("prefix/lib/libghostty-vt.a"), &library).expect("install libghostty-vt.a");
    std::fs::remove_dir_all(&staging).ok();
    library
}
