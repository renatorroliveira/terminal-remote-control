import type { TerminalPalette } from './themes';

/** The CSS system colors a Windows contrast theme sets, which forced colors give the UI (A11Y-07.3). */
export type SystemColor = 'Canvas' | 'CanvasText' | 'LinkText' | 'GrayText' | 'Highlight' | 'HighlightText';

/**
 * The terminal's palette in a Windows contrast theme with Match System (A11Y-07.3): only the colors the user's theme
 * sets. The background, text, cursor and selection are the theme's; of the ANSI colors, black is the background,
 * bright black the theme's dim text, blue and cyan its link color, and every other its text color. The minimum
 * contrast ratio keeps each one readable.
 */
export function systemTerminalPalette(color: (name: SystemColor) => string): TerminalPalette {
    const background = color('Canvas');
    const text = color('CanvasText');
    const link = color('LinkText');
    return {
        background,
        foreground: text,
        cursor: text,
        cursorAccent: background,
        selectionBackground: color('Highlight'),
        selectionForeground: color('HighlightText'),
        ansi: {
            black: background,
            red: text,
            green: text,
            yellow: text,
            blue: link,
            magenta: text,
            cyan: link,
            white: text,
            brightBlack: color('GrayText'),
            brightRed: text,
            brightGreen: text,
            brightYellow: text,
            brightBlue: link,
            brightMagenta: text,
            brightCyan: link,
            brightWhite: text,
        },
    };
}

/** A system color as `document` resolves it now, such as `rgb(255, 255, 0)` in a contrast theme. */
export function resolveSystemColor(document: Document, name: SystemColor): string {
    const probe = document.createElement('span');
    probe.style.display = 'none';
    probe.style.color = name;
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
}
