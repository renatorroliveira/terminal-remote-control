//! Raw FFI bindings to libghostty-vt.

/// The libghostty-vt release these bindings were generated from.
pub const LIBGHOSTTY_VT_VERSION: &str = "1.0.1";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn targets_libghostty_vt_1_0_1() {
        assert_eq!(LIBGHOSTTY_VT_VERSION, "1.0.1");
    }
}
