import type { ThemeName } from '../../shared/display';

/** The design tokens every theme defines. */
export interface Palette {
    readonly background: string;
    readonly surface: string;
    readonly text: string;
    readonly textMuted: string;
    readonly border: string;
    readonly accent: string;
    readonly accentText: string;
    readonly focusRing: string;
    readonly selectionBackground: string;
    readonly selectionText: string;
    readonly danger: string;
    readonly success: string;
    readonly warning: string;
    readonly terminalBackground: string;
    readonly terminalForeground: string;
    readonly terminalCursor: string;
}

/** The four built-in themes (A11Y-07.3). */
export const THEMES: Readonly<Record<ThemeName, Palette>> = {
    light: {
        background: '#ffffff',
        surface: '#f3f3f3',
        text: '#1f1f1f',
        textMuted: '#595959',
        border: '#767676',
        accent: '#0b5cad',
        accentText: '#ffffff',
        focusRing: '#0b5cad',
        selectionBackground: '#0b5cad',
        selectionText: '#ffffff',
        danger: '#b3261e',
        success: '#1e6b2e',
        warning: '#7a4a00',
        terminalBackground: '#ffffff',
        terminalForeground: '#1f1f1f',
        terminalCursor: '#1f1f1f',
    },
    dark: {
        background: '#1e1e1e',
        surface: '#252526',
        text: '#e8e8e8',
        textMuted: '#b3b3b3',
        border: '#8c8c8c',
        accent: '#6cb6ff',
        accentText: '#0b1a2a',
        focusRing: '#6cb6ff',
        selectionBackground: '#6cb6ff',
        selectionText: '#0b1a2a',
        danger: '#ff8a80',
        success: '#7ee08f',
        warning: '#ffc266',
        terminalBackground: '#1e1e1e',
        terminalForeground: '#d4d4d4',
        terminalCursor: '#e8e8e8',
    },
    'hc-light': {
        background: '#ffffff',
        surface: '#ffffff',
        text: '#000000',
        textMuted: '#1f1f1f',
        border: '#000000',
        accent: '#0033a0',
        accentText: '#ffffff',
        focusRing: '#0033a0',
        selectionBackground: '#000000',
        selectionText: '#ffffff',
        danger: '#8b0000',
        success: '#004d00',
        warning: '#5c3800',
        terminalBackground: '#ffffff',
        terminalForeground: '#000000',
        terminalCursor: '#000000',
    },
    'hc-dark': {
        background: '#000000',
        surface: '#000000',
        text: '#ffffff',
        textMuted: '#e0e0e0',
        border: '#ffffff',
        accent: '#8fd4ff',
        accentText: '#000000',
        focusRing: '#ffff00',
        selectionBackground: '#ffff00',
        selectionText: '#000000',
        danger: '#ff9e9e',
        success: '#8fff8f',
        warning: '#ffd54f',
        terminalBackground: '#000000',
        terminalForeground: '#ffffff',
        terminalCursor: '#ffffff',
    },
};

/** A token pair and the contrast it must reach (WCAG 2.2: 4.5:1 text, 3:1 non-text; PRD §11.2). */
export interface ContrastPair {
    readonly foreground: keyof Palette;
    readonly background: keyof Palette;
    readonly minimum: number;
}

const TEXT = 4.5;
const NON_TEXT = 3;

/** Every pair the UI and the terminal draw, checked in every theme. */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
    ...(['text', 'textMuted', 'accent', 'danger', 'success', 'warning'] as const).flatMap((foreground) =>
        (['background', 'surface'] as const).map((background) => ({ foreground, background, minimum: TEXT })),
    ),
    { foreground: 'accentText', background: 'accent', minimum: TEXT },
    { foreground: 'selectionText', background: 'selectionBackground', minimum: TEXT },
    { foreground: 'terminalForeground', background: 'terminalBackground', minimum: TEXT },
    { foreground: 'border', background: 'background', minimum: NON_TEXT },
    { foreground: 'border', background: 'surface', minimum: NON_TEXT },
    { foreground: 'focusRing', background: 'background', minimum: NON_TEXT },
    { foreground: 'focusRing', background: 'surface', minimum: NON_TEXT },
    { foreground: 'terminalCursor', background: 'terminalBackground', minimum: NON_TEXT },
    { foreground: 'selectionBackground', background: 'terminalBackground', minimum: NON_TEXT },
    { foreground: 'selectionBackground', background: 'background', minimum: NON_TEXT },
];

/** The token style sheet: the layer order, then each theme's custom properties in the `tokens` layer. */
export function themeStyleSheet(): string {
    const blocks = Object.entries(THEMES).map(([name, palette]) => {
        const properties = Object.entries(palette).map(
            ([token, value]) => `    --trc-color-${kebab(token)}: ${value};`,
        );
        return `:root[data-theme="${name}"] {\n${properties.join('\n')}\n}`;
    });
    return `@layer reset, tokens, base, components;\n@layer tokens {\n${blocks.join('\n')}\n}\n`;
}

function kebab(token: string): string {
    return token.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}
