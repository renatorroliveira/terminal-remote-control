import { describe, expect, it } from 'vitest';
import { resolveSystemColor, type SystemColor, systemTerminalPalette } from './system-palette';

const THEME: Readonly<Record<SystemColor, string>> = {
    Canvas: 'rgb(0, 0, 0)',
    CanvasText: 'rgb(255, 255, 0)',
    LinkText: 'rgb(128, 128, 255)',
    GrayText: 'rgb(0, 255, 0)',
    Highlight: 'rgb(0, 128, 255)',
    HighlightText: 'rgb(0, 0, 0)',
};

describe('systemTerminalPalette: the terminal in a Windows contrast theme (A11Y-07.3)', () => {
    it('takes the background, text, cursor and selection from the theme', () => {
        const palette = systemTerminalPalette((name) => THEME[name]);
        expect(palette).toMatchObject({
            background: THEME.Canvas,
            foreground: THEME.CanvasText,
            cursor: THEME.CanvasText,
            cursorAccent: THEME.Canvas,
            selectionBackground: THEME.Highlight,
            selectionForeground: THEME.HighlightText,
        });
    });

    it('gives the ANSI colors only the theme’s own: background, text, links and dim text', () => {
        const ansi = systemTerminalPalette((name) => THEME[name]).ansi;
        expect(ansi?.black).toBe(THEME.Canvas);
        expect(ansi?.brightBlack).toBe(THEME.GrayText);
        expect([ansi?.blue, ansi?.cyan, ansi?.brightBlue, ansi?.brightCyan]).toEqual(Array(4).fill(THEME.LinkText));
        expect([ansi?.red, ansi?.green, ansi?.white, ansi?.brightWhite]).toEqual(Array(4).fill(THEME.CanvasText));
        expect(new Set(Object.values(ansi ?? {}))).toEqual(
            new Set([THEME.Canvas, THEME.CanvasText, THEME.LinkText, THEME.GrayText]),
        );
    });

    it('resolves a system color in the page to an rgb value', () => {
        expect(resolveSystemColor(document, 'CanvasText')).toMatch(/^rgba?\(/);
        expect(document.body.children.length).toBe(0);
    });
});
