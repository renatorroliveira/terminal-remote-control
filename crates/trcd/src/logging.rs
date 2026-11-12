//! The core's JSON log: daily files in a private directory, with sensitive values redacted (SEC-08).

use std::fmt;
use std::io;
use std::path::Path;

use tracing_appender::rolling::{RollingFileAppender, Rotation};

/// How many daily log files are kept.
const KEPT_LOG_FILES: usize = 7;
/// What every value wrapped in [`Sensitive`] prints.
const REDACTED: &str = "[redacted]";

/// A value that must never reach a log: terminal bytes, keystrokes, environment values, clipboard data.
/// Its `Debug` and `Display` print `[redacted]`.
pub struct Sensitive<T>(pub T);

impl<T> fmt::Debug for Sensitive<T> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(REDACTED)
    }
}

impl<T> fmt::Display for Sensitive<T> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(REDACTED)
    }
}

/// Sends `tracing` events as JSON lines to `core.<date>.log` files in `logs_dir`, keeping the last week.
pub fn init(logs_dir: &Path) -> io::Result<()> {
    let appender = RollingFileAppender::builder()
        .rotation(Rotation::DAILY)
        .filename_prefix("core")
        .filename_suffix("log")
        .max_log_files(KEPT_LOG_FILES)
        .build(logs_dir)
        .map_err(io::Error::other)?;
    tracing_subscriber::fmt()
        .json()
        .with_ansi(false)
        .with_writer(appender)
        .try_init()
        .map_err(io::Error::other)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sensitive_values_print_as_redacted() {
        assert_eq!(format!("{:?}", Sensitive("hunter2")), "[redacted]");
        assert_eq!(format!("{}", Sensitive(vec![1, 2, 3])), "[redacted]");
    }

    #[test]
    fn writes_json_lines_without_sensitive_values() {
        let dir = crate::test_support::temp_dir("logs");
        init(&dir).unwrap();
        tracing::info!(value = %Sensitive("canary-7f3a"), session = "s1", "created");
        let logs: String = std::fs::read_dir(&dir)
            .unwrap()
            .map(|entry| std::fs::read_to_string(entry.unwrap().path()).unwrap())
            .collect();
        let line: serde_json::Value = serde_json::from_str(logs.lines().next().unwrap()).unwrap();
        assert_eq!(line["fields"]["message"], "created");
        assert_eq!(line["fields"]["value"], "[redacted]");
        assert!(!logs.contains("canary-7f3a"));
    }
}
