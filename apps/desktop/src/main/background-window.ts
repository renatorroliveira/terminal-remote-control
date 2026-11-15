import type { BrowserWindow, Rectangle } from 'electron';

/** The size a window opens at. */
export interface WindowSize {
    readonly width: number;
    readonly height: number;
}

/** Where and how a test build's window opens in the background: its bounds, fully transparent. */
export interface BackgroundWindowOptions extends Rectangle {
    readonly opacity: number;
}

/**
 * How a test build opens a window while `TRC_TEST_BACKGROUND` is set (P-14, D-27): fully transparent, in the bottom-right
 * corner of `workArea`, so a test run never shows a window over what the developer works on. A window larger than the
 * work area keeps to its top-left corner.
 */
export function backgroundWindowOptions(workArea: Rectangle, size: WindowSize): BackgroundWindowOptions {
    return {
        x: Math.max(workArea.x, workArea.x + workArea.width - size.width),
        y: Math.max(workArea.y, workArea.y + workArea.height - size.height),
        width: size.width,
        height: size.height,
        opacity: 0,
    };
}

/**
 * Shows a background window without taking focus, and lets every click pass through it to the app below; Playwright
 * still drives it, as its input goes straight to the page.
 */
export function showInBackground(window: BrowserWindow): void {
    window.setIgnoreMouseEvents(true);
    window.showInactive();
}
