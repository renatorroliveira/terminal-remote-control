/** How the user set screen-reader mode: follow Chromium's detection of assistive technology, or force it (A11Y-10.2). */
export const SCREEN_READER_MODES = ['auto', 'on', 'off'] as const;

/** One screen-reader mode. */
export type ScreenReaderMode = (typeof SCREEN_READER_MODES)[number];

/** What the main process reports about assistive technology. */
export interface AccessibilityState {
    /** Whether Chromium's accessibility support is on, which any assistive technology turns on. */
    readonly supportEnabled: boolean;
    readonly mode: ScreenReaderMode;
}

/** Whether screen-reader-optimized behavior, such as spoken output, is on (A11Y-10.2). */
export function screenReaderOn(state: AccessibilityState): boolean {
    return state.mode === 'auto' ? state.supportEnabled : state.mode === 'on';
}

/**
 * Whether the terminal keeps its assistive-technology cadence (S3a, R2): while Chromium serves assistive technology,
 * even with screen-reader mode forced off, and whenever screen-reader mode is on.
 */
export function assistiveTechnologyActive(state: AccessibilityState): boolean {
    return state.supportEnabled || screenReaderOn(state);
}
