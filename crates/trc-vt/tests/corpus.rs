//! Golden outputs for the S1 corpus: what libghostty-vt makes of each recorded sample at 80×24 (US-1.11).
//!
//! Run with `TRC_BLESS_FIXTURES=1` to rewrite `tests/corpus/expected/`. The Vitest replay test then checks that each
//! snapshot replays into xterm.js exactly like the original bytes.

use std::path::{Path, PathBuf};

use trc_vt::{GhosttyTerminal, Rgb, TerminalConfig, TerminalEvent, TerminalSize, TerminalState};

fn corpus_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/corpus")
}

fn config() -> TerminalConfig {
    TerminalConfig {
        size: TerminalSize { cols: 80, rows: 24 },
        scrollback_lines: 10_000,
        xtversion: "trcd 0.0.0".into(),
        foreground: Rgb(0xdd, 0xdd, 0xdd),
        background: Rgb(0x11, 0x11, 0x11),
    }
}

fn summary(term: &GhosttyTerminal, events: &[TerminalEvent]) -> serde_json::Value {
    let replies: Vec<u8> = events
        .iter()
        .filter_map(|event| match event {
            TerminalEvent::Reply(bytes) => Some(bytes.clone()),
            _ => None,
        })
        .flatten()
        .collect();
    serde_json::json!({
        "cursor": [term.cursor().0, term.cursor().1],
        "alternateScreen": term.alternate_screen(),
        "scrollbackRows": term.scrollback_rows(),
        "replies": String::from_utf8_lossy(&replies),
        "plain": term.plain_text().unwrap(),
    })
}

#[test]
fn corpus_outputs_match_the_golden_files() {
    let bless = std::env::var_os("TRC_BLESS_FIXTURES").is_some();
    let expected_dir = corpus_dir().join("expected");
    let mut samples: Vec<PathBuf> = std::fs::read_dir(corpus_dir())
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "vt"))
        .collect();
    samples.sort();
    assert!(samples.len() >= 16, "the S1 corpus has 16 samples");
    for sample in samples {
        let name = sample.file_stem().unwrap().to_string_lossy().into_owned();
        let mut term = GhosttyTerminal::new(&config()).unwrap();
        let events = term.feed(&std::fs::read(&sample).unwrap());
        let json = serde_json::to_string_pretty(&summary(&term, &events)).unwrap() + "\n";
        let snapshot = term.snapshot().unwrap();
        let json_path = expected_dir.join(format!("{name}.json"));
        let snapshot_path = expected_dir.join(format!("{name}.snapshot"));
        if bless {
            std::fs::create_dir_all(&expected_dir).unwrap();
            std::fs::write(&json_path, &json).unwrap();
            std::fs::write(&snapshot_path, &snapshot).unwrap();
        }
        assert_eq!(
            std::fs::read_to_string(&json_path).unwrap(),
            json,
            "{name}: summary differs"
        );
        assert_eq!(
            std::fs::read(&snapshot_path).unwrap(),
            snapshot,
            "{name}: snapshot differs"
        );
    }
}
