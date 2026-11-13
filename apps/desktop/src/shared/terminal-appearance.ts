/** The cursor shapes the terminal draws (A11Y-07.8). */
export const CURSOR_STYLES = ['block', 'bar', 'underline'] as const;

/** One cursor shape. */
export type CursorStyle = (typeof CURSOR_STYLES)[number];

/** How the terminal grid and its cursor look, kept in `config.json` (A11Y-07.6, A11Y-07.8, A11Y-08.1). */
export interface TerminalAppearance {
    /** Row height as a multiple of the font's line height. */
    readonly lineHeight: number;
    /** Extra space between columns, in CSS pixels. */
    readonly letterSpacing: number;
    readonly cursorStyle: CursorStyle;
    /** The bar cursor's thickness, in CSS pixels. */
    readonly cursorWidth: number;
    /** Whether the cursor blinks; never while the OS reduces motion, and not after 5 s without input. */
    readonly cursorBlink: boolean;
}

/** The appearance of a new install. */
export const DEFAULT_TERMINAL_APPEARANCE: TerminalAppearance = {
    lineHeight: 1,
    letterSpacing: 0,
    cursorStyle: 'block',
    cursorWidth: 2,
    cursorBlink: false,
};

/** The ranges the appearance settings accept. */
export const TERMINAL_APPEARANCE_LIMITS = {
    lineHeight: { min: 1, max: 2 },
    letterSpacing: { min: 0, max: 4 },
    cursorWidth: { min: 1, max: 6 },
} as const;
