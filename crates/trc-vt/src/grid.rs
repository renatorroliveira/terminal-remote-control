//! Row-level access to a libghostty-vt terminal by raw handle: points, tracked rows, soft wraps, formatting a range of
//! rows, and a private copy of the primary screen (S12).

use std::ptr::{null, null_mut};

use ghostty_vt_sys as sys;
use sys::GhosttyFormatterOption as FormatterOption;
use sys::GhosttyPointTag::Type as Tag;

use crate::VtError;
use crate::ghostty::{Formatter, check};

/// The whole screen, history first, as one coordinate space.
pub(crate) const SCREEN: Tag = sys::GhosttyPointTag::GHOSTTY_POINT_TAG_SCREEN;
/// The visible screen.
pub(crate) const ACTIVE: Tag = sys::GhosttyPointTag::GHOSTTY_POINT_TAG_ACTIVE;

/// A row that follows its content as output scrolls it, until pruning removes it.
pub(crate) struct TrackedRow(sys::GhosttyTrackedGridRef);

impl TrackedRow {
    /// Tracks row `y` of `terminal`, counted in [`SCREEN`] coordinates.
    pub(crate) fn new(terminal: sys::GhosttyTerminal, y: u32) -> Result<Self, VtError> {
        let mut tracked: sys::GhosttyTrackedGridRef = null_mut();
        // SAFETY: `terminal` is live and `tracked` is a valid out pointer; the reference is freed in `Drop`.
        check(unsafe { sys::ghostty_terminal_grid_ref_track(terminal, point(SCREEN, 0, y), &mut tracked) })?;
        Ok(Self(tracked))
    }

    /// The row's current [`SCREEN`] coordinate, or `None` once pruning removed it.
    pub(crate) fn y(&self) -> Option<u32> {
        // SAFETY: the reference is live until `Drop`; it reports no value when its row or terminal is gone.
        if !unsafe { sys::ghostty_tracked_grid_ref_has_value(self.0) } {
            return None;
        }
        let mut at = sys::GhosttyPointCoordinate { x: 0, y: 0 };
        // SAFETY: as above, and `at` is a valid out pointer.
        let result = unsafe { sys::ghostty_tracked_grid_ref_point(self.0, SCREEN, &mut at) };
        (result == sys::GhosttyResult::GHOSTTY_SUCCESS).then_some(at.y)
    }
}

impl Drop for TrackedRow {
    fn drop(&mut self) {
        // SAFETY: the reference came from `ghostty_terminal_grid_ref_track` and is not used after this.
        unsafe { sys::ghostty_tracked_grid_ref_free(self.0) };
    }
}

/// A terminal decoded from a binary snapshot of another, switched to its primary screen. libghostty-vt formats only
/// the active screen, so this is how a snapshot reaches the primary screen while a full-screen program runs.
pub(crate) struct PrimaryCopy(sys::GhosttyTerminal);

impl PrimaryCopy {
    /// Copies `terminal` and leaves the alternate screen in the copy.
    pub(crate) fn of(terminal: sys::GhosttyTerminal) -> Result<Self, VtError> {
        let mut ptr: *mut u8 = null_mut();
        let mut len: usize = 0;
        // SAFETY: `terminal` is live; `ptr` and `len` are valid out pointers, and the buffer is freed below.
        check(unsafe { sys::ghostty_snapshot_encode_alloc(terminal, null(), &mut ptr, &mut len) })?;
        let decoded = decode(ptr, len);
        // SAFETY: `ptr` came from `ghostty_snapshot_encode_alloc` with the default allocator.
        unsafe { sys::ghostty_free(null(), ptr, len) };
        let copy = Self(decoded?);
        let leave = b"\x1b[?1049l";
        // SAFETY: the copy is a live terminal owned by `copy`, and `leave` outlives the call.
        unsafe { sys::ghostty_terminal_vt_write(copy.0, leave.as_ptr(), leave.len()) };
        Ok(copy)
    }

    /// The copy's handle; it stays owned by `self`.
    pub(crate) fn raw(&self) -> sys::GhosttyTerminal {
        self.0
    }
}

impl Drop for PrimaryCopy {
    fn drop(&mut self) {
        // SAFETY: the terminal came from the snapshot decoder, which handed its ownership over, and is not used after.
        unsafe { sys::ghostty_terminal_free(self.0) };
    }
}

/// Rows in `terminal`'s history, above the screen.
pub(crate) fn history_rows(terminal: sys::GhosttyTerminal) -> u32 {
    let mut rows: usize = 0;
    // SAFETY: SCROLLBACK_ROWS writes a `usize`.
    unsafe {
        sys::ghostty_terminal_get(
            terminal,
            sys::GhosttyTerminalData::GHOSTTY_TERMINAL_DATA_SCROLLBACK_ROWS,
            (&raw mut rows).cast(),
        )
    };
    u32::try_from(rows).unwrap_or(u32::MAX)
}

/// The width and height of `terminal`'s screen.
pub(crate) fn screen_size(terminal: sys::GhosttyTerminal) -> (u16, u16) {
    let get = |data| {
        let mut value: u16 = 0;
        // SAFETY: COLS and ROWS write a `u16`.
        unsafe { sys::ghostty_terminal_get(terminal, data, (&raw mut value).cast()) };
        value
    };
    (
        get(sys::GhosttyTerminalData::GHOSTTY_TERMINAL_DATA_COLS),
        get(sys::GhosttyTerminalData::GHOSTTY_TERMINAL_DATA_ROWS),
    )
}

/// Whether row `y` (in `tag` coordinates) soft-wraps into the next one.
pub(crate) fn wraps(terminal: sys::GhosttyTerminal, tag: Tag, y: u32) -> Result<bool, VtError> {
    let cell = grid_ref(terminal, tag, 0, y)?;
    let mut row: sys::GhosttyRow = 0;
    // SAFETY: `cell` was just returned for this terminal, which has not changed since.
    check(unsafe { sys::ghostty_grid_ref_row(&cell, &mut row) })?;
    let mut wrap = false;
    // SAFETY: WRAP writes a `bool`.
    check(unsafe { sys::ghostty_row_get(row, sys::GhosttyRowData::GHOSTTY_ROW_DATA_WRAP, (&raw mut wrap).cast()) })?;
    Ok(wrap)
}

/// Formats rows `first..=last` (in `tag` coordinates) as VT output with `extras`, keeping every row of the range.
pub(crate) fn format_rows(
    terminal: sys::GhosttyTerminal,
    tag: Tag,
    first: u32,
    last: u32,
    extras: sys::GhosttyFormatterExtras,
) -> Result<Vec<u8>, VtError> {
    let (cols, _) = screen_size(terminal);
    let selection = sys::GhosttySelection {
        start: grid_ref(terminal, tag, 0, first)?,
        end: grid_ref(terminal, tag, cols.saturating_sub(1), last)?,
        rectangle: false,
    };
    let formatter = Formatter::new(terminal)?;
    let emit = sys::GhosttyFormatterFormat::GHOSTTY_FORMATTER_FORMAT_VT;
    formatter.set(FormatterOption::GHOSTTY_FORMATTER_OPT_EMIT, &emit)?;
    formatter.set(FormatterOption::GHOSTTY_FORMATTER_OPT_EXTRAS, &extras)?;
    formatter.set(FormatterOption::GHOSTTY_FORMATTER_OPT_TRIM, &false)?;
    formatter.set(FormatterOption::GHOSTTY_FORMATTER_OPT_SELECTION, &selection)?;
    formatter.format()
}

fn decode(ptr: *const u8, len: usize) -> Result<sys::GhosttyTerminal, VtError> {
    let mut decoder: sys::GhosttySnapshotDecoder = null_mut();
    // SAFETY: `ptr` holds `len` bytes that stay valid until the decoder is freed below.
    check(unsafe { sys::ghostty_snapshot_decoder_new_buf(null(), &mut decoder, ptr, len) })?;
    let mut terminal: sys::GhosttyTerminal = null_mut();
    // SAFETY: `decoder` is live and `terminal` is a valid out pointer; ownership of the terminal passes to the caller.
    let result = check(unsafe { sys::ghostty_snapshot_decoder_decode(decoder, &mut terminal) });
    // SAFETY: the decoder is not used after this; freeing it keeps the decoded terminal.
    unsafe { sys::ghostty_snapshot_decoder_free(decoder) };
    result.map(|()| terminal)
}

fn grid_ref(terminal: sys::GhosttyTerminal, tag: Tag, x: u16, y: u32) -> Result<sys::GhosttyGridRef, VtError> {
    let mut cell = sys::GhosttyGridRef {
        node: null_mut(),
        x: 0,
        y: 0,
    };
    // SAFETY: `terminal` is live and `cell` is a valid out pointer.
    check(unsafe { sys::ghostty_terminal_grid_ref(terminal, point(tag, x, y), &mut cell) })?;
    Ok(cell)
}

fn point(tag: Tag, x: u16, y: u32) -> sys::GhosttyPoint {
    let mut value = sys::GhosttyPointValue { _padding: [0; 2] };
    value.coordinate = sys::GhosttyPointCoordinate { x, y };
    sys::GhosttyPoint { tag, value }
}
