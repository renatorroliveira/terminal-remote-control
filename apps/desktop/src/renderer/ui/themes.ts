import type { ThemeName } from '../../shared/display';

/** The app UI's design tokens. */
export interface UiPalette {
    readonly background: string;
    readonly surface: string;
    readonly text: string;
    readonly textMuted: string;
    readonly border: string;
    readonly accent: string;
    readonly accentText: string;
    /** The fill of the primary button of a view. */
    readonly primary: string;
    readonly primaryText: string;
    /** The primary button's edge, which must stand out from the page (non-text contrast). */
    readonly primaryBorder: string;
    readonly focusRing: string;
    readonly selectionBackground: string;
    readonly selectionText: string;
    readonly danger: string;
    readonly success: string;
    readonly warning: string;
}

/** The 16 ANSI colors programs pick by number. */
export interface AnsiPalette {
    readonly black: string;
    readonly red: string;
    readonly green: string;
    readonly yellow: string;
    readonly blue: string;
    readonly magenta: string;
    readonly cyan: string;
    readonly white: string;
    readonly brightBlack: string;
    readonly brightRed: string;
    readonly brightGreen: string;
    readonly brightYellow: string;
    readonly brightBlue: string;
    readonly brightMagenta: string;
    readonly brightCyan: string;
    readonly brightWhite: string;
}

/** The terminal's own colors, kept apart from the UI's, as in VS Code themes. */
export interface TerminalPalette {
    readonly background: string;
    readonly foreground: string;
    readonly cursor: string;
    /** The glyph color under a block cursor. */
    readonly cursorAccent: string;
    readonly selectionBackground: string;
    readonly selectionForeground: string;
    /** The ANSI colors; xterm.js defaults when absent. The minimum contrast ratio keeps either readable. */
    readonly ansi?: AnsiPalette;
}

/** A built-in theme. */
export interface Theme {
    readonly ui: UiPalette;
    readonly terminal: TerminalPalette;
}

/** A token pair of one palette and the contrast it must reach (WCAG 2.2: 4.5:1 text, 3:1 non-text; PRD §11.2). */
export interface ContrastPair<P> {
    readonly foreground: keyof P & string;
    readonly background: keyof P & string;
    readonly minimum: number;
}

/**
 * Midnight, the default theme: A11y Matrix Dark, a WCAG AAA high-contrast dark VS Code theme. Selection is inverted
 * (black on the theme's 7:1 border green), because the theme's selection fill is 1.96:1 against black, under the
 * 3:1 that selection needs (A11Y-04).
 */
const MIDNIGHT: Theme = {
    ui: {
        background: '#000000',
        surface: '#000000',
        text: '#d2d2d2',
        textMuted: '#b3b3b3',
        border: '#00ad2c',
        accent: '#00f33e',
        accentText: '#000000',
        primary: '#004d1a',
        primaryText: '#ffffff',
        primaryBorder: '#00ad2c',
        focusRing: '#ffb000',
        selectionBackground: '#00ad2c',
        selectionText: '#000000',
        danger: '#f48771',
        success: '#89d185',
        warning: '#ffcb58',
    },
    terminal: {
        background: '#000000',
        foreground: '#d2d2d2',
        cursor: '#d2d2d2',
        cursorAccent: '#000000',
        selectionBackground: '#00ad2c',
        selectionForeground: '#000000',
        ansi: {
            black: '#000000',
            red: '#ff6161',
            green: '#00ad2c',
            yellow: '#ff9547',
            blue: '#8888ff',
            magenta: '#ff29ff',
            cyan: '#00b8b8',
            white: '#b3b3b3',
            brightBlack: '#959595',
            brightRed: '#ff9696',
            brightGreen: '#00f33e',
            brightYellow: '#b8b800',
            brightBlue: '#c4caff',
            brightMagenta: '#ff85ff',
            brightCyan: '#00d6a4',
            brightWhite: '#d2d2d2',
        },
    },
};

/** The built-in themes: Midnight, the default, and the four that follow the OS (A11Y-07.3). */
export const THEMES: Readonly<Record<ThemeName, Theme>> = {
    midnight: MIDNIGHT,
    light: {
        ui: {
            background: '#ffffff',
            surface: '#f3f3f3',
            text: '#1f1f1f',
            textMuted: '#595959',
            border: '#767676',
            accent: '#0b5cad',
            accentText: '#ffffff',
            primary: '#0b5cad',
            primaryText: '#ffffff',
            primaryBorder: '#0b5cad',
            focusRing: '#0b5cad',
            selectionBackground: '#0b5cad',
            selectionText: '#ffffff',
            danger: '#b3261e',
            success: '#1e6b2e',
            warning: '#7a4a00',
        },
        terminal: {
            background: '#ffffff',
            foreground: '#1f1f1f',
            cursor: '#1f1f1f',
            cursorAccent: '#ffffff',
            selectionBackground: '#0b5cad',
            selectionForeground: '#ffffff',
        },
    },
    dark: {
        ui: {
            background: '#1e1e1e',
            surface: '#252526',
            text: '#e8e8e8',
            textMuted: '#b3b3b3',
            border: '#8c8c8c',
            accent: '#6cb6ff',
            accentText: '#0b1a2a',
            primary: '#0e639c',
            primaryText: '#ffffff',
            primaryBorder: '#6cb6ff',
            focusRing: '#6cb6ff',
            selectionBackground: '#6cb6ff',
            selectionText: '#0b1a2a',
            danger: '#ff8a80',
            success: '#7ee08f',
            warning: '#ffc266',
        },
        terminal: {
            background: '#1e1e1e',
            foreground: '#d4d4d4',
            cursor: '#e8e8e8',
            cursorAccent: '#1e1e1e',
            selectionBackground: '#6cb6ff',
            selectionForeground: '#0b1a2a',
        },
    },
    'hc-light': {
        ui: {
            background: '#ffffff',
            surface: '#ffffff',
            text: '#000000',
            textMuted: '#1f1f1f',
            border: '#000000',
            accent: '#0033a0',
            accentText: '#ffffff',
            primary: '#0033a0',
            primaryText: '#ffffff',
            primaryBorder: '#0033a0',
            focusRing: '#0033a0',
            selectionBackground: '#000000',
            selectionText: '#ffffff',
            danger: '#8b0000',
            success: '#004d00',
            warning: '#5c3800',
        },
        terminal: {
            background: '#ffffff',
            foreground: '#000000',
            cursor: '#000000',
            cursorAccent: '#ffffff',
            selectionBackground: '#000000',
            selectionForeground: '#ffffff',
        },
    },
    'hc-dark': {
        ui: {
            background: '#000000',
            surface: '#000000',
            text: '#ffffff',
            textMuted: '#e0e0e0',
            border: '#ffffff',
            accent: '#8fd4ff',
            accentText: '#000000',
            primary: '#8fd4ff',
            primaryText: '#000000',
            primaryBorder: '#ffffff',
            focusRing: '#ffff00',
            selectionBackground: '#ffff00',
            selectionText: '#000000',
            danger: '#ff9e9e',
            success: '#8fff8f',
            warning: '#ffd54f',
        },
        terminal: {
            background: '#000000',
            foreground: '#ffffff',
            cursor: '#ffffff',
            cursorAccent: '#000000',
            selectionBackground: '#ffff00',
            selectionForeground: '#000000',
        },
    },
};

const TEXT = 4.5;
const NON_TEXT = 3;

/** Every pair the UI draws, checked in every theme. */
export const UI_CONTRAST_PAIRS: readonly ContrastPair<UiPalette>[] = [
    ...(['text', 'textMuted', 'accent', 'danger', 'success', 'warning'] as const).flatMap((foreground) =>
        (['background', 'surface'] as const).map((background) => ({ foreground, background, minimum: TEXT })),
    ),
    { foreground: 'accentText', background: 'accent', minimum: TEXT },
    { foreground: 'primaryText', background: 'primary', minimum: TEXT },
    { foreground: 'primaryBorder', background: 'background', minimum: NON_TEXT },
    { foreground: 'primaryBorder', background: 'surface', minimum: NON_TEXT },
    { foreground: 'selectionText', background: 'selectionBackground', minimum: TEXT },
    { foreground: 'border', background: 'background', minimum: NON_TEXT },
    { foreground: 'border', background: 'surface', minimum: NON_TEXT },
    { foreground: 'focusRing', background: 'background', minimum: NON_TEXT },
    { foreground: 'focusRing', background: 'surface', minimum: NON_TEXT },
    { foreground: 'selectionBackground', background: 'background', minimum: NON_TEXT },
];

/** Every pair the terminal draws, checked in every theme. */
export const TERMINAL_CONTRAST_PAIRS: readonly ContrastPair<Omit<TerminalPalette, 'ansi'>>[] = [
    { foreground: 'foreground', background: 'background', minimum: TEXT },
    { foreground: 'cursor', background: 'background', minimum: NON_TEXT },
    { foreground: 'cursorAccent', background: 'cursor', minimum: TEXT },
    { foreground: 'selectionBackground', background: 'background', minimum: NON_TEXT },
    { foreground: 'selectionForeground', background: 'selectionBackground', minimum: TEXT },
];

/**
 * The token style sheet: the layer order, then each theme's custom properties in the `tokens` layer. UI tokens are
 * `--trc-color-<token>` and terminal tokens `--trc-color-terminal-<token>`.
 */
export function themeStyleSheet(): string {
    const blocks = Object.entries(THEMES).map(([name, theme]) => {
        const { ansi: _ansi, ...terminal } = theme.terminal;
        const properties = [
            ...Object.entries(theme.ui).map(([token, value]) => `    --trc-color-${kebab(token)}: ${value};`),
            ...Object.entries(terminal).map(([token, value]) => `    --trc-color-terminal-${kebab(token)}: ${value};`),
        ];
        return `:root[data-theme="${name}"] {\n${properties.join('\n')}\n}`;
    });
    return `@layer reset, tokens, base, components;\n@layer tokens {\n${blocks.join('\n')}\n}\n`;
}

function kebab(token: string): string {
    return token.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}
