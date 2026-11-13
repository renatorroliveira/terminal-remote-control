import type { Terminal } from '@xterm/xterm';

/** The part of xterm.js's private core that decides whether the cursor is drawn at all. */
interface CursorCore {
    readonly _core?: { readonly coreService?: { isCursorInitialized: boolean } };
}

/**
 * Lets xterm.js draw its cursor. xterm.js draws none until its own hidden textarea has had focus once, and here the
 * Accessible Text Surface takes all focus and input, so the cursor would never appear (A11Y-06.6). This is the one
 * use of xterm.js internals (D-32); the cursor tests fail if an upgrade moves the flag.
 */
export function showCursor(terminal: Terminal): void {
    const coreService = (terminal as unknown as CursorCore)._core?.coreService;
    if (coreService !== undefined && !coreService.isCursorInitialized) {
        coreService.isCursorInitialized = true;
        terminal.refresh(0, terminal.rows - 1);
    }
}
