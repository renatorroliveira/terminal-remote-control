import type { ITheme } from '@xterm/xterm';
import type { TerminalPalette } from '../ui/themes';

/** A theme's terminal colors in xterm.js form; the terminal has its own palette, apart from the UI's (A11Y-07). */
export function xtermTheme(palette: TerminalPalette): ITheme {
    return {
        background: palette.background,
        foreground: palette.foreground,
        cursor: palette.cursor,
        cursorAccent: palette.cursorAccent,
        selectionBackground: palette.selectionBackground,
        selectionForeground: palette.selectionForeground,
        selectionInactiveBackground: palette.selectionBackground,
        ...palette.ansi,
    };
}
