//! Removes control characters from text that comes from terminal output before it is shown or spoken (SEC-06.4).

/// Returns `text` without C0 controls, DEL and C1 controls.
pub fn strip_controls(text: &str) -> String {
    text.chars().filter(|c| !c.is_control()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removes_c0_del_and_c1_controls_and_keeps_other_text() {
        assert_eq!(
            strip_controls("a\u{1b}]0;x\u{7}b\u{7f}c\u{9b}d\te\u{85}f"),
            "a]0;xbcdef"
        );
        assert_eq!(strip_controls("日本語 👍🏽"), "日本語 👍🏽");
    }
}
