//! The UI Automation reads behind each command.

use std::time::{Duration, Instant};

use windows::Win32::Foundation::POINT;
use windows::Win32::System::Com::{
    CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED, CoCreateInstance, CoInitializeEx, SAFEARRAY,
};
use windows::Win32::System::Ole::{SafeArrayAccessData, SafeArrayDestroy, SafeArrayGetUBound, SafeArrayUnaccessData};
use windows::Win32::UI::Accessibility::{
    CUIAutomation, IUIAutomation, IUIAutomationElement, IUIAutomationTextPattern, IUIAutomationTextPattern2,
    IUIAutomationTextRange, TextPatternRangeEndpoint_End, TextUnit_Character, TextUnit_Line, UIA_TextPattern2Id,
    UIA_TextPatternId,
};
use windows::core::Result;

use crate::json::{Object, quote, rects};

/// What a command printed and whether it read what it was asked.
pub struct Report {
    /// The JSON text.
    pub text: String,
    /// Whether the read succeeded.
    pub ok: bool,
}

/// How much of the document's text the report holds.
const TEXT_PREFIX: i32 = 400;
/// How much of a selection's text the report holds.
const SELECTION_TEXT: i32 = 2_000;
const POLL: Duration = Duration::from_millis(50);

/// The focused element, once it belongs to process `pid`, within `timeout`.
pub fn focused(pid: i32, timeout: Duration) -> Report {
    outcome(automation().and_then(|automation| {
        let deadline = Instant::now() + timeout;
        loop {
            // SAFETY: plain COM calls on a valid IUIAutomation and the element it returns.
            let element = unsafe { automation.GetFocusedElement() }.ok();
            let owner = element
                .as_ref()
                .and_then(|element| unsafe { element.CurrentProcessId() }.ok());
            if let (Some(element), Some(owner)) = (&element, owner)
                && owner == pid
            {
                return describe(element);
            }
            if Instant::now() >= deadline {
                let holder = owner.map_or_else(|| "nothing".to_owned(), |owner| format!("process {owner}"));
                return Ok(error_text(&format!(
                    "no element of process {pid} took focus; {holder} holds it"
                )));
            }
            std::thread::sleep(POLL);
        }
    }))
}

/// The line of text under the screen point `(x, y)`, from the nearest element with a text pattern there.
pub fn at(x: i32, y: i32) -> Report {
    outcome(automation().and_then(|automation| {
        let point = POINT { x, y };
        // SAFETY: plain COM calls on a valid IUIAutomation.
        let element = unsafe { automation.ElementFromPoint(point) }?;
        let Some(pattern) = text_pattern_at_or_above(&automation, element)? else {
            return Ok(error_text("no element with text under the point"));
        };
        // SAFETY: plain COM calls on a valid text pattern and range.
        let line = unsafe {
            let range = pattern.RangeFromPoint(point)?;
            range.ExpandToEnclosingUnit(TextUnit_Line)?;
            range.GetText(TEXT_PREFIX)?.to_string()
        };
        Ok(Object::default().string("line", &line).finish())
    }))
}

fn automation() -> Result<IUIAutomation> {
    // SAFETY: initializes COM for this thread once; the probe exits right after.
    unsafe {
        CoInitializeEx(None, COINIT_MULTITHREADED).ok()?;
        CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
    }
}

fn describe(element: &IUIAutomationElement) -> Result<String> {
    let mut report = Object::default();
    // SAFETY: plain property reads on a valid element.
    unsafe {
        report
            .number("controlType", f64::from(element.CurrentControlType()?.0))
            .string(
                "localizedControlType",
                &element.CurrentLocalizedControlType()?.to_string(),
            )
            .string("name", &element.CurrentName()?.to_string())
            .string("className", &element.CurrentClassName()?.to_string())
            .boolean("hasKeyboardFocus", element.CurrentHasKeyboardFocus()?.as_bool());
    }
    // SAFETY: a pattern the element does not support is an error, reported as absent.
    let pattern = unsafe { element.GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId) }.ok();
    report.boolean("textPattern", pattern.is_some());
    if let Some(pattern) = pattern {
        text_fields(&mut report, &pattern)?;
        caret_field(&mut report, element)?;
    }
    Ok(report.finish())
}

fn text_fields(report: &mut Object, pattern: &IUIAutomationTextPattern) -> Result<()> {
    // SAFETY: plain COM calls on a valid text pattern and its ranges.
    unsafe {
        report.string(
            "textPrefix",
            &pattern.DocumentRange()?.GetText(TEXT_PREFIX)?.to_string(),
        );
        let selection = pattern.GetSelection()?;
        let mut items = Vec::new();
        for index in 0..selection.Length()? {
            let range = selection.GetElement(index)?;
            items.push(
                Object::default()
                    .string("text", &range.GetText(SELECTION_TEXT)?.to_string())
                    .raw("rects", &rects(&bounding_rects(&range)?))
                    .finish(),
            );
        }
        report.raw("selection", &format!("[{}]", items.join(",")));
    }
    Ok(())
}

/// The caret's bounds from `TextPattern2`, widened to one character when the collapsed range reports none.
fn caret_field(report: &mut Object, element: &IUIAutomationElement) -> Result<()> {
    // SAFETY: a pattern the element does not support is an error, reported as absent.
    let Ok(pattern) = (unsafe { element.GetCurrentPatternAs::<IUIAutomationTextPattern2>(UIA_TextPattern2Id) }) else {
        report.boolean("textPattern2", false);
        return Ok(());
    };
    let mut active = false.into();
    // SAFETY: plain COM calls on a valid text pattern and range.
    unsafe {
        let caret = pattern.GetCaretRange(&mut active)?;
        let mut bounds = bounding_rects(&caret)?;
        if bounds.is_empty() {
            caret.MoveEndpointByUnit(TextPatternRangeEndpoint_End, TextUnit_Character, 1)?;
            bounds = bounding_rects(&caret)?;
        }
        report
            .boolean("textPattern2", true)
            .boolean("caretActive", active.as_bool())
            .raw("caretRects", &rects(&bounds));
    }
    Ok(())
}

fn text_pattern_at_or_above(
    automation: &IUIAutomation,
    element: IUIAutomationElement,
) -> Result<Option<IUIAutomationTextPattern>> {
    // SAFETY: plain COM calls on valid UI Automation objects.
    unsafe {
        let walker = automation.ControlViewWalker()?;
        let mut current = Some(element);
        while let Some(candidate) = current {
            if let Ok(pattern) = candidate.GetCurrentPatternAs::<IUIAutomationTextPattern>(UIA_TextPatternId) {
                return Ok(Some(pattern));
            }
            current = walker.GetParentElement(&candidate).ok();
        }
    }
    Ok(None)
}

/// A range's bounding rectangles: UI Automation returns them as a flat array of doubles, four per rectangle.
fn bounding_rects(range: &IUIAutomationTextRange) -> Result<Vec<[f64; 4]>> {
    // SAFETY: the array GetBoundingRectangles returns holds doubles, is read only within its bounds while accessed,
    // and is destroyed once.
    unsafe {
        let array: *mut SAFEARRAY = range.GetBoundingRectangles()?;
        if array.is_null() {
            return Ok(Vec::new());
        }
        let count = usize::try_from(SafeArrayGetUBound(array, 1)? + 1).unwrap_or(0);
        let mut data = std::ptr::null_mut();
        SafeArrayAccessData(array, &mut data)?;
        let values = std::slice::from_raw_parts(data.cast::<f64>(), count).to_vec();
        SafeArrayUnaccessData(array)?;
        SafeArrayDestroy(array)?;
        Ok(values.as_chunks::<4>().0.to_vec())
    }
}

fn error_text(message: &str) -> String {
    format!("{{\"error\":{}}}", quote(message))
}

fn outcome(result: Result<String>) -> Report {
    match result {
        Ok(text) => Report {
            ok: !text.starts_with("{\"error\""),
            text,
        },
        Err(error) => Report {
            text: error_text(&error.message()),
            ok: false,
        },
    }
}
