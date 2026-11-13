//! [`TerminalState`] on libghostty-vt.

use std::ffi::c_void;
use std::ptr::{NonNull, null, null_mut};

use ghostty_vt_sys as sys;
use sys::GhosttyFormatterFormat::{GHOSTTY_FORMATTER_FORMAT_PLAIN, GHOSTTY_FORMATTER_FORMAT_VT};
use sys::GhosttyFormatterOption as FormatterOption;
use sys::GhosttyTerminalData as Data;
use sys::GhosttyTerminalOption as Opt;

use crate::sanitize::strip_controls;
use crate::{Rgb, TerminalConfig, TerminalEvent, TerminalSize, TerminalState, VtError};

/// DEC private mode 2027: grapheme clustering, which keeps emoji sequences in one cell (S1).
const GRAPHEME_CLUSTER_MODE: sys::GhosttyMode = 2027;
/// Extra lines asked of libghostty-vt so that whole-page pruning never keeps fewer than the configured limit.
const PAGE_SLACK_LINES: usize = 1024;
/// Every formatter extra except the palette, so a snapshot restores modes, cursor, styles and character sets but
/// never overrides the app's theme colors (A11Y-07).
const SNAPSHOT_EXTRAS: sys::GhosttyFormatterExtras = 0xfff & !1;

/// A libghostty-vt terminal configured for `trcd`: grapheme clustering on, title reports off, line-bounded
/// scrollback, and query replies collected as [`TerminalEvent::Reply`].
pub struct GhosttyTerminal {
    raw: sys::GhosttyTerminal,
    /// Owned through a raw pointer, from `Box::into_raw`, because libghostty's callbacks write through the same
    /// pointer: a `Box` would claim unique access that those writes break. Freed in `Drop`.
    effects: NonNull<Effects>,
    size: TerminalSize,
}

impl GhosttyTerminal {
    /// Creates a terminal.
    pub fn new(config: &TerminalConfig) -> Result<Self, VtError> {
        let mut raw: sys::GhosttyTerminal = null_mut();
        // SAFETY: a null allocator selects the default allocator, and `raw` is a valid out pointer.
        check(unsafe { sys::ghostty_terminal_new(null(), &mut raw, config.size.cols, config.size.rows) })?;
        let effects = NonNull::from(Box::leak(Box::new(Effects {
            pending: Vec::new(),
            xtversion: config.xtversion.clone().into_bytes(),
        })));
        let mut terminal = Self {
            raw,
            effects,
            size: config.size,
        };
        terminal.configure(config)?;
        Ok(terminal)
    }

    fn configure(&mut self, config: &TerminalConfig) -> Result<(), VtError> {
        let userdata: *mut Effects = self.effects.as_ptr();
        self.set_raw(Opt::GHOSTTY_TERMINAL_OPT_USERDATA, userdata.cast_const().cast())?;
        let write_pty: sys::GhosttyTerminalWritePtyFn = Some(on_write_pty);
        let title: sys::GhosttyTerminalTitleChangedFn = Some(on_title_changed);
        let pwd: sys::GhosttyTerminalPwdChangedFn = Some(on_pwd_changed);
        let bell: sys::GhosttyTerminalBellFn = Some(on_bell);
        let xtversion: sys::GhosttyTerminalXtversionFn = Some(on_xtversion);
        self.set_raw(
            Opt::GHOSTTY_TERMINAL_OPT_WRITE_PTY,
            write_pty.map_or(null(), |f| f as *const c_void),
        )?;
        self.set_raw(
            Opt::GHOSTTY_TERMINAL_OPT_TITLE_CHANGED,
            title.map_or(null(), |f| f as *const c_void),
        )?;
        self.set_raw(
            Opt::GHOSTTY_TERMINAL_OPT_PWD_CHANGED,
            pwd.map_or(null(), |f| f as *const c_void),
        )?;
        self.set_raw(
            Opt::GHOSTTY_TERMINAL_OPT_BELL,
            bell.map_or(null(), |f| f as *const c_void),
        )?;
        self.set_raw(
            Opt::GHOSTTY_TERMINAL_OPT_XTVERSION,
            xtversion.map_or(null(), |f| f as *const c_void),
        )?;
        self.set_value(Opt::GHOSTTY_TERMINAL_OPT_COLOR_FOREGROUND, &rgb(config.foreground))?;
        self.set_value(Opt::GHOSTTY_TERMINAL_OPT_COLOR_BACKGROUND, &rgb(config.background))?;
        self.set_value(Opt::GHOSTTY_TERMINAL_OPT_SCROLLBACK_MAX_BYTES, &usize::MAX)?;
        let lines = config.scrollback_lines.saturating_add(PAGE_SLACK_LINES);
        self.set_value(Opt::GHOSTTY_TERMINAL_OPT_SCROLLBACK_MAX_LINES, &lines)?;
        self.set_value(Opt::GHOSTTY_TERMINAL_OPT_TITLE_REPORT, &false)?;
        let grapheme = sys::GhosttyTerminalModeConfig {
            mode: GRAPHEME_CLUSTER_MODE,
            value: true,
        };
        self.set_value(Opt::GHOSTTY_TERMINAL_OPT_MODE_DEFAULT, &grapheme)
    }

    fn set_value<T>(&mut self, option: sys::GhosttyTerminalOption::Type, value: &T) -> Result<(), VtError> {
        self.set_raw(option, (value as *const T).cast())
    }

    fn set_raw(&mut self, option: sys::GhosttyTerminalOption::Type, value: *const c_void) -> Result<(), VtError> {
        // SAFETY: `raw` is a live terminal, and every caller passes the value type the option documents.
        check(unsafe { sys::ghostty_terminal_set(self.raw, option, value) })
    }

    fn get_u16(&self, data: sys::GhosttyTerminalData::Type) -> u16 {
        let mut value: u16 = 0;
        // SAFETY: the data keys used with this helper write a `u16`.
        unsafe { sys::ghostty_terminal_get(self.raw, data, (&raw mut value).cast()) };
        value
    }

    fn get_usize(&self, data: sys::GhosttyTerminalData::Type) -> usize {
        let mut value: usize = 0;
        // SAFETY: the data keys used with this helper write a `usize`.
        unsafe { sys::ghostty_terminal_get(self.raw, data, (&raw mut value).cast()) };
        value
    }

    fn get_string(&self, data: sys::GhosttyTerminalData::Type) -> Option<String> {
        let mut value = sys::GhosttyString { ptr: null(), len: 0 };
        // SAFETY: TITLE and PWD write a borrowed `GhosttyString`, valid until the next mutating call.
        unsafe { sys::ghostty_terminal_get(self.raw, data, (&raw mut value).cast()) };
        if value.ptr.is_null() || value.len == 0 {
            return None;
        }
        // SAFETY: the library returned `len` readable bytes at `ptr`, and nothing mutates the terminal meanwhile.
        let bytes = unsafe { std::slice::from_raw_parts(value.ptr, value.len) };
        Some(strip_controls(&String::from_utf8_lossy(bytes)))
    }

    fn format(&self, emit: sys::GhosttyFormatterFormat::Type, extras: u32, trim: bool) -> Result<Vec<u8>, VtError> {
        let formatter = Formatter::new(self.raw)?;
        formatter.set(FormatterOption::GHOSTTY_FORMATTER_OPT_EMIT, &emit)?;
        formatter.set(FormatterOption::GHOSTTY_FORMATTER_OPT_EXTRAS, &extras)?;
        formatter.set(FormatterOption::GHOSTTY_FORMATTER_OPT_TRIM, &trim)?;
        formatter.format()
    }

    fn take_events(&mut self) -> Vec<TerminalEvent> {
        // SAFETY: `effects` is live until `Drop`, and no callback runs outside `feed`, so nothing else touches it here.
        let pending = std::mem::take(&mut unsafe { self.effects.as_mut() }.pending);
        pending
            .into_iter()
            .filter_map(|effect| match effect {
                Effect::Reply(bytes) => Some(TerminalEvent::Reply(bytes)),
                Effect::Title => self.title().map(TerminalEvent::Title),
                Effect::WorkingDirectory => self.working_directory().map(TerminalEvent::WorkingDirectory),
                Effect::Bell => Some(TerminalEvent::Bell),
            })
            .collect()
    }
}

impl TerminalState for GhosttyTerminal {
    fn feed(&mut self, bytes: &[u8]) -> Vec<TerminalEvent> {
        // SAFETY: `raw` is a live terminal and `bytes` outlives the call. Callbacks only append to `effects`.
        unsafe { sys::ghostty_terminal_vt_write(self.raw, bytes.as_ptr(), bytes.len()) };
        self.take_events()
    }

    fn resize(&mut self, size: TerminalSize) -> Result<(), VtError> {
        // SAFETY: `raw` is a live terminal. The daemon knows no pixel sizes, so it reports none.
        check(unsafe { sys::ghostty_terminal_resize(self.raw, size.cols, size.rows, 0, 0) })?;
        self.size = size;
        Ok(())
    }

    fn snapshot(&self) -> Result<Vec<u8>, VtError> {
        self.format(GHOSTTY_FORMATTER_FORMAT_VT, SNAPSHOT_EXTRAS, false)
    }

    fn plain_text(&self) -> Result<String, VtError> {
        let bytes = self.format(GHOSTTY_FORMATTER_FORMAT_PLAIN, 0, true)?;
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    }

    fn size(&self) -> TerminalSize {
        self.size
    }

    fn cursor(&self) -> (u16, u16) {
        (
            self.get_u16(Data::GHOSTTY_TERMINAL_DATA_CURSOR_X),
            self.get_u16(Data::GHOSTTY_TERMINAL_DATA_CURSOR_Y),
        )
    }

    fn alternate_screen(&self) -> bool {
        let mut screen: sys::GhosttyTerminalScreen::Type = sys::GhosttyTerminalScreen::GHOSTTY_TERMINAL_SCREEN_PRIMARY;
        // SAFETY: ACTIVE_SCREEN writes a `GhosttyTerminalScreen`.
        unsafe {
            sys::ghostty_terminal_get(
                self.raw,
                Data::GHOSTTY_TERMINAL_DATA_ACTIVE_SCREEN,
                (&raw mut screen).cast(),
            )
        };
        screen == sys::GhosttyTerminalScreen::GHOSTTY_TERMINAL_SCREEN_ALTERNATE
    }

    fn scrollback_rows(&self) -> usize {
        self.get_usize(Data::GHOSTTY_TERMINAL_DATA_SCROLLBACK_ROWS)
    }

    fn title(&self) -> Option<String> {
        self.get_string(Data::GHOSTTY_TERMINAL_DATA_TITLE)
    }

    fn working_directory(&self) -> Option<String> {
        self.get_string(Data::GHOSTTY_TERMINAL_DATA_PWD)
    }
}

impl Drop for GhosttyTerminal {
    fn drop(&mut self) {
        // SAFETY: `raw` was created by `ghostty_terminal_new` and is not used after this.
        unsafe { sys::ghostty_terminal_free(self.raw) };
        // SAFETY: `effects` came from `Box::leak` in `new`; the terminal that called back into it is freed above.
        drop(unsafe { Box::from_raw(self.effects.as_ptr()) });
    }
}

struct Effects {
    pending: Vec<Effect>,
    xtversion: Vec<u8>,
}

enum Effect {
    Reply(Vec<u8>),
    Title,
    WorkingDirectory,
    Bell,
}

struct Formatter(sys::GhosttyFormatter);

impl Formatter {
    fn new(terminal: sys::GhosttyTerminal) -> Result<Self, VtError> {
        let mut raw: sys::GhosttyFormatter = null_mut();
        // SAFETY: `terminal` is live for the formatter's whole lifetime, which ends inside `GhosttyTerminal::format`.
        check(unsafe { sys::ghostty_formatter_terminal_new(null(), &mut raw, terminal) })?;
        Ok(Self(raw))
    }

    fn set<T>(&self, option: sys::GhosttyFormatterOption::Type, value: &T) -> Result<(), VtError> {
        // SAFETY: every caller passes the value type the option documents; the formatter copies it.
        check(unsafe { sys::ghostty_formatter_set(self.0, option, (value as *const T).cast()) })
    }

    fn format(&self) -> Result<Vec<u8>, VtError> {
        let mut ptr: *mut u8 = null_mut();
        let mut len: usize = 0;
        // SAFETY: `ptr` and `len` are valid out pointers; the buffer is freed below with the same allocator.
        check(unsafe { sys::ghostty_formatter_format_alloc(self.0, null(), &mut ptr, &mut len) })?;
        let bytes = if ptr.is_null() {
            Vec::new()
        } else {
            // SAFETY: the formatter returned `len` initialized bytes at `ptr`.
            unsafe { std::slice::from_raw_parts(ptr, len) }.to_vec()
        };
        if !ptr.is_null() {
            // SAFETY: `ptr` came from `ghostty_formatter_format_alloc` with the default allocator.
            unsafe { sys::ghostty_free(null(), ptr, len) };
        }
        Ok(bytes)
    }
}

impl Drop for Formatter {
    fn drop(&mut self) {
        // SAFETY: the formatter was created by `ghostty_formatter_terminal_new` and is not used after this.
        unsafe { sys::ghostty_formatter_free(self.0) };
    }
}

fn check(result: sys::GhosttyResult::Type) -> Result<(), VtError> {
    if result == sys::GhosttyResult::GHOSTTY_SUCCESS {
        Ok(())
    } else {
        Err(VtError::Engine(result))
    }
}

fn rgb(color: Rgb) -> sys::GhosttyColorRgb {
    sys::GhosttyColorRgb {
        r: color.0,
        g: color.1,
        b: color.2,
    }
}

/// Recovers the effect sink from the terminal's userdata.
///
/// # Safety
/// `userdata` must be the `Effects` pointer set in `configure`, which lives as long as the terminal.
unsafe fn effects<'a>(userdata: *mut c_void) -> &'a mut Effects {
    // SAFETY: guaranteed by the caller.
    unsafe { &mut *userdata.cast::<Effects>() }
}

unsafe extern "C" fn on_write_pty(_terminal: sys::GhosttyTerminal, userdata: *mut c_void, data: *const u8, len: usize) {
    // SAFETY: libghostty passes the userdata set in `configure` and `len` readable bytes at `data`.
    let (effects, bytes) = unsafe { (effects(userdata), std::slice::from_raw_parts(data, len)) };
    effects.pending.push(Effect::Reply(bytes.to_vec()));
}

unsafe extern "C" fn on_title_changed(_terminal: sys::GhosttyTerminal, userdata: *mut c_void) {
    // SAFETY: libghostty passes the userdata set in `configure`.
    unsafe { effects(userdata) }.pending.push(Effect::Title);
}

unsafe extern "C" fn on_pwd_changed(_terminal: sys::GhosttyTerminal, userdata: *mut c_void) {
    // SAFETY: libghostty passes the userdata set in `configure`.
    unsafe { effects(userdata) }.pending.push(Effect::WorkingDirectory);
}

unsafe extern "C" fn on_bell(_terminal: sys::GhosttyTerminal, userdata: *mut c_void) {
    // SAFETY: libghostty passes the userdata set in `configure`.
    unsafe { effects(userdata) }.pending.push(Effect::Bell);
}

unsafe extern "C" fn on_xtversion(_terminal: sys::GhosttyTerminal, userdata: *mut c_void) -> sys::GhosttyString {
    // SAFETY: libghostty passes the userdata set in `configure`; the string lives as long as the terminal.
    let version = &unsafe { effects(userdata) }.xtversion;
    sys::GhosttyString {
        ptr: version.as_ptr(),
        len: version.len(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Rgb;

    fn config(cols: u16, rows: u16, scrollback_lines: usize) -> TerminalConfig {
        TerminalConfig {
            size: TerminalSize { cols, rows },
            scrollback_lines,
            xtversion: "trcd 9.9.9".into(),
            foreground: Rgb(0xdd, 0xdd, 0xdd),
            background: Rgb(0x11, 0x11, 0x11),
        }
    }

    fn terminal(cols: u16, rows: u16) -> GhosttyTerminal {
        GhosttyTerminal::new(&config(cols, rows, 10_000)).unwrap()
    }

    fn replies(events: &[TerminalEvent]) -> Vec<u8> {
        events
            .iter()
            .filter_map(|event| match event {
                TerminalEvent::Reply(bytes) => Some(bytes.clone()),
                _ => None,
            })
            .flatten()
            .collect()
    }

    #[test]
    fn tracks_text_and_the_cursor() {
        let mut term = terminal(80, 24);
        term.feed(b"hello\r\nworld");
        assert_eq!(term.cursor(), (5, 1));
        assert_eq!(term.plain_text().unwrap(), "hello\nworld");
    }

    #[test]
    fn answers_device_cursor_version_and_color_queries() {
        let mut term = terminal(80, 24);
        let events = term.feed(b"\x1b[c\x1b[6n\x1b[>0q\x1b]10;?\x1b\\\x1b]11;?\x1b\\");
        assert_eq!(
            String::from_utf8(replies(&events)).unwrap(),
            "\x1b[?62;22c\x1b[1;1R\x1bP>|trcd 9.9.9\x1b\\\x1b]10;rgb:dddd/dddd/dddd\x1b\\\x1b]11;rgb:1111/1111/1111\x1b\\"
        );
    }

    #[test]
    fn never_echoes_the_title_or_the_clipboard_back_sec_06_3() {
        let mut term = terminal(80, 24);
        let events = term.feed(b"\x1b]2;rm -rf ~\x07\x1b[21t\x1b]52;c;?\x1b\\");
        assert_eq!(replies(&events), b"");
    }

    #[test]
    fn reports_title_working_directory_and_bell_without_controls() {
        let mut term = terminal(80, 24);
        let events = term.feed(b"\x1b]0;build\x01done\x07\x1b]7;file://host/home/tester\x07\x07");
        assert_eq!(
            events,
            [
                TerminalEvent::Title("builddone".into()),
                TerminalEvent::WorkingDirectory("file://host/home/tester".into()),
                TerminalEvent::Bell,
            ]
        );
        assert_eq!(term.title().as_deref(), Some("builddone"));
        assert_eq!(term.working_directory().as_deref(), Some("file://host/home/tester"));
    }

    #[test]
    fn clusters_graphemes_by_default() {
        let mut term = terminal(80, 24);
        term.feed("1\u{fe0f}\u{20e3}|".as_bytes());
        assert_eq!(term.cursor(), (3, 0));
    }

    #[test]
    fn reflows_on_resize() {
        let mut term = terminal(10, 5);
        term.feed(b"0123456789abcdef");
        assert_eq!(term.plain_text().unwrap(), "0123456789\nabcdef");
        term.resize(TerminalSize { cols: 20, rows: 5 }).unwrap();
        assert_eq!(term.size(), TerminalSize { cols: 20, rows: 5 });
        assert_eq!(term.plain_text().unwrap(), "0123456789abcdef");
    }

    #[test]
    fn tracks_the_alternate_screen() {
        let mut term = terminal(80, 24);
        term.feed(b"\x1b[?1049h");
        assert!(term.alternate_screen());
        term.feed(b"\x1b[?1049l");
        assert!(!term.alternate_screen());
    }

    #[test]
    fn keeps_at_least_the_configured_scrollback_lines_nfr_10() {
        for (cols, limit) in [(80, 1_000), (120, 2_000), (200, 10_000)] {
            let mut term = GhosttyTerminal::new(&config(cols, 24, limit)).unwrap();
            let line = format!("{}\r\n", "x".repeat(usize::from(cols) - 1));
            term.feed(line.repeat(limit * 2 + 5_000).as_bytes());
            let rows = term.scrollback_rows();
            assert!(
                (limit..limit + 2 * PAGE_SLACK_LINES).contains(&rows),
                "{cols} columns, limit {limit}: kept {rows}"
            );
        }
    }

    #[test]
    fn snapshots_never_carry_the_palette() {
        let mut term = terminal(20, 3);
        term.feed(b"x");
        let snapshot = String::from_utf8(term.snapshot().unwrap()).unwrap();
        assert!(!snapshot.contains("\x1b]4;"), "{snapshot:?}");
    }

    #[test]
    fn snapshots_replay_into_an_identical_terminal() {
        let mut term = terminal(40, 6);
        term.feed(b"\x1b[31mred\x1b[0m line\r\nsecond \xe6\x97\xa5\xe6\x9c\xac\r\n\x1b[3;5Hcursor");
        let mut replay = terminal(40, 6);
        replay.feed(&term.snapshot().unwrap());
        assert_eq!(replay.plain_text().unwrap(), term.plain_text().unwrap());
        assert_eq!(replay.cursor(), term.cursor());
    }
}
