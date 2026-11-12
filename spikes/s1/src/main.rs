#![allow(non_camel_case_types, non_upper_case_globals, non_snake_case, dead_code, unsafe_op_in_unsafe_fn)]
mod ffi {
    include!("bindings.rs");
}
use ffi::*;
use std::ffi::c_void;
use std::io::{Read, Write};
use std::ptr::{null, null_mut};

struct Capture {
    replies: Vec<u8>,
    title_changes: u32,
    bells: u32,
}

unsafe extern "C" fn on_write(_t: GhosttyTerminal, ud: *mut c_void, data: *const u8, len: usize) {
    let cap = &mut *(ud as *mut Capture);
    cap.replies.extend_from_slice(std::slice::from_raw_parts(data, len));
}
unsafe extern "C" fn on_title(_t: GhosttyTerminal, ud: *mut c_void) {
    (*(ud as *mut Capture)).title_changes += 1;
}
unsafe extern "C" fn on_bell(_t: GhosttyTerminal, ud: *mut c_void) {
    (*(ud as *mut Capture)).bells += 1;
}
static XTV: &[u8] = b"trcd 0.0.0";
unsafe extern "C" fn on_xtversion(_t: GhosttyTerminal, _ud: *mut c_void) -> GhosttyString {
    GhosttyString { ptr: XTV.as_ptr(), len: XTV.len() }
}
unsafe extern "C" fn on_size(_t: GhosttyTerminal, _ud: *mut c_void, out: *mut GhosttySizeReportSize) -> bool {
    let _ = out;
    false
}

struct Term {
    t: GhosttyTerminal,
    cap: Box<Capture>,
}

impl Term {
    fn new(cols: u16, rows: u16, scrollback: usize) -> Term {
        unsafe {
            let mut t: GhosttyTerminal = null_mut();
            assert_eq!(ghostty_terminal_new(null(), &mut t, cols, rows), 0);
            let mut cap = Box::new(Capture { replies: vec![], title_changes: 0, bells: 0 });
            let ud = &mut *cap as *mut Capture as *const c_void;
            use GhosttyTerminalOption::*;
            assert_eq!(ghostty_terminal_set(t, GHOSTTY_TERMINAL_OPT_USERDATA, ud), 0);
            let w: GhosttyTerminalWritePtyFn = Some(on_write);
            assert_eq!(ghostty_terminal_set(t, GHOSTTY_TERMINAL_OPT_WRITE_PTY, w.map_or(null(), |f| f as *const c_void)), 0);
            let tc: GhosttyTerminalTitleChangedFn = Some(on_title);
            ghostty_terminal_set(t, GHOSTTY_TERMINAL_OPT_TITLE_CHANGED, tc.map_or(null(), |f| f as *const c_void));
            let b: GhosttyTerminalBellFn = Some(on_bell);
            ghostty_terminal_set(t, GHOSTTY_TERMINAL_OPT_BELL, b.map_or(null(), |f| f as *const c_void));
            let x: GhosttyTerminalXtversionFn = Some(on_xtversion);
            ghostty_terminal_set(t, GHOSTTY_TERMINAL_OPT_XTVERSION, x.map_or(null(), |f| f as *const c_void));
            let fg = GhosttyColorRgb { r: 0xdd, g: 0xdd, b: 0xdd };
            let bg = GhosttyColorRgb { r: 0x11, g: 0x11, b: 0x11 };
            ghostty_terminal_set(t, GHOSTTY_TERMINAL_OPT_COLOR_FOREGROUND, &fg as *const _ as *const c_void);
            ghostty_terminal_set(t, GHOSTTY_TERMINAL_OPT_COLOR_BACKGROUND, &bg as *const _ as *const c_void);
            let unlimited = usize::MAX;
            ghostty_terminal_set(t, GHOSTTY_TERMINAL_OPT_SCROLLBACK_MAX_BYTES, &unlimited as *const _ as *const c_void);
            ghostty_terminal_set(t, GHOSTTY_TERMINAL_OPT_SCROLLBACK_MAX_LINES, &scrollback as *const _ as *const c_void);
            Term { t, cap }
        }
    }
    fn feed(&mut self, bytes: &[u8]) {
        unsafe { ghostty_terminal_vt_write(self.t, bytes.as_ptr(), bytes.len()) }
    }
    fn get_u16(&self, d: GhosttyTerminalData::Type) -> u16 {
        let mut v: u16 = 0;
        unsafe { ghostty_terminal_get(self.t, d, &mut v as *mut _ as *mut c_void) };
        v
    }
    fn get_usize(&self, d: GhosttyTerminalData::Type) -> usize {
        let mut v: usize = 0;
        unsafe { ghostty_terminal_get(self.t, d, &mut v as *mut _ as *mut c_void) };
        v
    }
    fn format(&self, emit: GhosttyFormatterFormat::Type, extras: u32, unwrap: bool) -> Vec<u8> {
        unsafe {
            let mut f: GhosttyFormatter = null_mut();
            assert_eq!(ghostty_formatter_terminal_new(null(), &mut f, self.t), 0);
            use GhosttyFormatterOption::*;
            ghostty_formatter_set(f, GHOSTTY_FORMATTER_OPT_EMIT, &emit as *const _ as *const c_void);
            ghostty_formatter_set(f, GHOSTTY_FORMATTER_OPT_EXTRAS, &extras as *const _ as *const c_void);
            ghostty_formatter_set(f, GHOSTTY_FORMATTER_OPT_UNWRAP, &unwrap as *const _ as *const c_void);
            let trim = emit != GhosttyFormatterFormat::GHOSTTY_FORMATTER_FORMAT_VT;
            ghostty_formatter_set(f, GHOSTTY_FORMATTER_OPT_TRIM, &trim as *const _ as *const c_void);
            let mut p: *mut u8 = null_mut();
            let mut n: usize = 0;
            assert_eq!(ghostty_formatter_format_alloc(f, null(), &mut p, &mut n), 0);
            let out = if p.is_null() { vec![] } else { std::slice::from_raw_parts(p, n).to_vec() };
            ghostty_free(null(), p, n);
            ghostty_formatter_free(f);
            out
        }
    }
}

impl Drop for Term {
    fn drop(&mut self) {
        unsafe { ghostty_terminal_free(self.t) }
    }
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn json_str(s: &[u8]) -> String {
    let s = String::from_utf8_lossy(s);
    let mut o = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            c if (c as u32) < 0x20 => o.push_str(&format!("\\u{:04x}", c as u32)),
            c => o.push(c),
        }
    }
    o.push('"');
    o
}

fn corpus(cols: u16, rows: u16, files: &[String]) {
    use GhosttyTerminalData::*;
    print!("[");
    for (i, file) in files.iter().enumerate() {
        let bytes = std::fs::read(file).unwrap();
        let mut t = Term::new(cols, rows, 10_000);
        if std::env::var_os("S1_GRAPHEME").is_some() {
            t.feed(b"\x1b[?2027h");
        }
        t.feed(&bytes);
        let vt = t.format(GhosttyFormatterFormat::GHOSTTY_FORMATTER_FORMAT_VT, 0xFFF, false);
        let plain = t.format(GhosttyFormatterFormat::GHOSTTY_FORMATTER_FORMAT_PLAIN, 0, false);
        let sep = if i == 0 { "" } else { "," };
        print!(
            "{sep}{{\"name\":{},\"cursor\":[{},{}],\"activeScreen\":{},\"scrollbackRows\":{},\"plain\":{},\"vt\":\"{}\",\"replies\":\"{}\",\"titleChanges\":{},\"bells\":{}}}",
            json_str(file.as_bytes()),
            t.get_u16(GHOSTTY_TERMINAL_DATA_CURSOR_X),
            t.get_u16(GHOSTTY_TERMINAL_DATA_CURSOR_Y),
            t.get_usize(GHOSTTY_TERMINAL_DATA_ACTIVE_SCREEN) as u32,
            t.get_usize(GHOSTTY_TERMINAL_DATA_SCROLLBACK_ROWS),
            json_str(&plain),
            hex(&vt),
            hex(&t.cap.replies),
            t.cap.title_changes,
            t.cap.bells
        );
    }
    println!("]");
}

fn pss_kib() -> String {
    std::fs::read_to_string("/proc/self/smaps_rollup")
        .ok()
        .and_then(|s| s.lines().find(|l| l.starts_with("Pss:")).map(|l| l.to_string()))
        .unwrap_or_else(|| "Pss: n/a".into())
}

fn rss() -> String {
    std::fs::read_to_string("/proc/self/status")
        .ok()
        .and_then(|s| s.lines().find(|l| l.starts_with("VmRSS:")).map(|l| l.to_string()))
        .unwrap_or_else(|| "VmRSS: n/a".into())
}

fn holder(lines: usize, cols: u16) {
    use portable_pty::{CommandBuilder, PtySize, native_pty_system};
    let pty = native_pty_system();
    let pair = pty.openpty(PtySize { rows: 24, cols, pixel_width: 0, pixel_height: 0 }).unwrap();
    let mut cmd = CommandBuilder::new("/bin/sh");
    let width = (cols as usize).saturating_sub(1);
    let script = format!(
        "awk 'BEGIN {{ for (i = 0; i < {lines}; i++) {{ s = i \"\"; while (length(s) < {width}) s = s \"x\"; print s }} }}'; sleep 1"
    );
    cmd.args(["-c", &script]);
    let mut child = pair.slave.spawn_command(cmd).unwrap();
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().unwrap();
    let mut t = Term::new(cols, 24, 10_000);
    let before = (pss_kib(), rss());
    let mut buf = [0u8; 65536];
    let mut total = 0usize;
    loop {
        match reader.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                total += n;
                t.feed(&buf[..n]);
            }
        }
    }
    let _ = child.wait();
    use GhosttyTerminalData::*;
    println!(
        "lines={lines} cols={cols} bytes={total} scrollback_rows={} before=[{} {}] after=[{} {}]",
        t.get_usize(GHOSTTY_TERMINAL_DATA_SCROLLBACK_ROWS),
        before.0,
        before.1,
        pss_kib(),
        rss()
    );
    std::io::stdout().flush().unwrap();
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("corpus") => corpus(args[2].parse().unwrap(), args[3].parse().unwrap(), &args[4..]),
        Some("holder") => holder(args[2].parse().unwrap(), args[3].parse().unwrap()),
        _ => eprintln!("usage: s1 corpus <cols> <rows> <files..> | s1 holder <lines> <cols>"),
    }
}
