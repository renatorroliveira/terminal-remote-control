import Color from 'colorjs.io';
import { describe, expect, it } from 'vitest';
import { TERMINAL_CONTRAST_PAIRS, THEMES, themeStyleSheet, UI_CONTRAST_PAIRS } from './themes';

function contrast(foreground: string, background: string): number {
    return new Color(foreground).contrastWCAG21(new Color(background));
}

const NAMES = Object.keys(THEMES) as (keyof typeof THEMES)[];

describe.each(NAMES)('the %s theme (A11Y-07.1, A11Y-06.6, A11Y-04)', (name) => {
    it.each(UI_CONTRAST_PAIRS)(
        'UI $foreground on $background reaches $minimum:1',
        ({ foreground, background, minimum }) => {
            const { ui } = THEMES[name];
            expect(contrast(ui[foreground], ui[background])).toBeGreaterThanOrEqual(minimum);
        },
    );

    it.each(TERMINAL_CONTRAST_PAIRS)(
        'terminal $foreground on $background reaches $minimum:1',
        ({ foreground, background, minimum }) => {
            const { terminal } = THEMES[name];
            expect(contrast(terminal[foreground], terminal[background])).toBeGreaterThanOrEqual(minimum);
        },
    );
});

describe('the Midnight theme', () => {
    it('takes its UI and terminal colors from A11y Matrix Dark, kept apart', () => {
        const { ui, terminal } = THEMES.midnight;
        expect(ui).toMatchObject({ background: '#000000', text: '#d2d2d2', focusRing: '#ffb000', border: '#00ad2c' });
        expect(terminal).toMatchObject({ background: '#000000', foreground: '#d2d2d2', cursor: '#d2d2d2' });
        expect(terminal.ansi).toMatchObject({
            green: '#00ad2c',
            brightGreen: '#00f33e',
            blue: '#8888ff',
            red: '#ff6161',
        });
    });

    it('keeps AAA text contrast in the UI and the terminal', () => {
        const { ui, terminal } = THEMES.midnight;
        expect(contrast(ui.text, ui.background)).toBeGreaterThanOrEqual(7);
        expect(contrast(terminal.foreground, terminal.background)).toBeGreaterThanOrEqual(7);
        expect(contrast(terminal.selectionForeground, terminal.selectionBackground)).toBeGreaterThanOrEqual(7);
    });
});

describe('primary buttons', () => {
    it('draw their text at AA contrast on their fill, and their border at 3:1 against the page (A11Y-07.1)', () => {
        expect(UI_CONTRAST_PAIRS).toContainEqual({ foreground: 'primaryText', background: 'primary', minimum: 4.5 });
        expect(UI_CONTRAST_PAIRS).toContainEqual({ foreground: 'primaryBorder', background: 'background', minimum: 3 });
        expect(UI_CONTRAST_PAIRS).toContainEqual({ foreground: 'primaryBorder', background: 'surface', minimum: 3 });
    });

    it('are white on dark green with the bright green edge in Midnight', () => {
        expect(THEMES.midnight.ui).toMatchObject({
            primary: '#004d1a',
            primaryText: '#ffffff',
            primaryBorder: '#00ad2c',
        });
    });
});

describe('secondary buttons', () => {
    it('draw their text at AA contrast on their fill, and their border at 3:1 against the page (A11Y-07.1)', () => {
        expect(UI_CONTRAST_PAIRS).toContainEqual({
            foreground: 'secondaryText',
            background: 'secondary',
            minimum: 4.5,
        });
        expect(UI_CONTRAST_PAIRS).toContainEqual({
            foreground: 'secondaryBorder',
            background: 'background',
            minimum: 3,
        });
        expect(UI_CONTRAST_PAIRS).toContainEqual({ foreground: 'secondaryBorder', background: 'surface', minimum: 3 });
    });

    it('are light text on dark gray with a gray edge in Midnight', () => {
        expect(THEMES.midnight.ui).toMatchObject({
            secondary: '#333333',
            secondaryText: '#d2d2d2',
            secondaryBorder: '#8c8c8c',
        });
    });
});

describe('themeStyleSheet', () => {
    it('declares the layers and one custom property per UI and terminal token and theme', () => {
        const css = themeStyleSheet();
        expect(css.startsWith('@layer reset, tokens, base, components;')).toBe(true);
        for (const name of NAMES) {
            expect(css).toContain(`:root[data-theme="${name}"]`);
        }
        expect(css).toContain('--trc-color-focus-ring:');
        expect(css).toContain('--trc-color-primary-border:');
        expect(css).toContain('--trc-color-terminal-background:');
    });
});
