//! Bringing an app's window to the foreground, which Windows' foreground lock refuses to a process started from a
//! background console, such as a test's app launched by Playwright (P-97).

use windows::Win32::Foundation::{HWND, LPARAM};
use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
use windows::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, EnumWindows, GW_OWNER, GetForegroundWindow, GetWindow, GetWindowThreadProcessId, IsWindowVisible,
    SetForegroundWindow,
};
use windows::core::BOOL;

use crate::json::Object;
use crate::probe::Report;

/// Makes the first visible, unowned top-level window of process `pid` the foreground window, attaching this thread's
/// input to the current foreground window's thread for the switch, as the lock allows that thread to hand it over.
pub fn foreground(pid: u32) -> Report {
    let Some(target) = top_level_window(pid) else {
        return failure(&format!("process {pid} has no visible window"));
    };
    // SAFETY: plain user32 calls on window handles that exist at this moment; a closed one makes them fail, not crash.
    let reached = unsafe {
        let current = GetForegroundWindow();
        let holder = GetWindowThreadProcessId(current, None);
        let own = GetCurrentThreadId();
        let attached = holder != 0 && holder != own && AttachThreadInput(own, holder, true).as_bool();
        let _ = BringWindowToTop(target);
        let _ = SetForegroundWindow(target);
        if attached {
            let _ = AttachThreadInput(own, holder, false);
        }
        GetForegroundWindow() == target
    };
    if reached {
        Report {
            text: Object::default().string("foreground", &pid.to_string()).finish(),
            ok: true,
        }
    } else {
        failure(&format!(
            "Windows kept another window in the foreground instead of process {pid}'s"
        ))
    }
}

fn failure(message: &str) -> Report {
    Report {
        text: Object::default().string("error", message).finish(),
        ok: false,
    }
}

/// What `EnumWindows` looks for, and the window it found.
struct Search {
    pid: u32,
    found: Option<HWND>,
}

fn top_level_window(pid: u32) -> Option<HWND> {
    let mut search = Search { pid, found: None };
    // SAFETY: the callback only runs during this call, while `search` lives; it reads the pointer as that `Search`.
    let _ = unsafe { EnumWindows(Some(visit), LPARAM(std::ptr::from_mut(&mut search) as isize)) };
    search.found
}

unsafe extern "system" fn visit(window: HWND, state: LPARAM) -> BOOL {
    // SAFETY: `state` is the `Search` that `top_level_window` passed, alive for the whole enumeration.
    let search = unsafe { &mut *(state.0 as *mut Search) };
    let mut owner = 0;
    // SAFETY: plain reads of a window handle EnumWindows passed.
    let wanted = unsafe {
        GetWindowThreadProcessId(window, Some(&mut owner));
        owner == search.pid && IsWindowVisible(window).as_bool() && GetWindow(window, GW_OWNER).is_err()
    };
    if wanted {
        search.found = Some(window);
    }
    BOOL::from(!wanted)
}
