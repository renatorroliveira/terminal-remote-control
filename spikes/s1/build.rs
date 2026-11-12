fn main() {
    let dir = std::env::var("GHOSTTY_VT_LIB_DIR").expect("set GHOSTTY_VT_LIB_DIR");
    println!("cargo:rustc-link-search=native={dir}");
    println!("cargo:rustc-link-lib=static=ghostty-vt");
    println!("cargo:rerun-if-env-changed=GHOSTTY_VT_LIB_DIR");
}
