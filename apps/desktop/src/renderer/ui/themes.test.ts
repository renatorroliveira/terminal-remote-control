import Color from 'colorjs.io';
import { describe, expect, it } from 'vitest';
import { CONTRAST_PAIRS, THEMES, themeStyleSheet } from './themes';

function contrast(foreground: string, background: string): number {
    return new Color(foreground).contrastWCAG21(new Color(background));
}

describe.each(Object.keys(THEMES) as (keyof typeof THEMES)[])('the %s theme (A11Y-07.1, A11Y-06.6)', (name) => {
    it.each(CONTRAST_PAIRS)('$foreground on $background reaches $minimum:1', ({ foreground, background, minimum }) => {
        const palette = THEMES[name];
        expect(contrast(palette[foreground], palette[background])).toBeGreaterThanOrEqual(minimum);
    });
});

describe('themeStyleSheet', () => {
    it('declares the layers and one custom property per token and theme', () => {
        const css = themeStyleSheet();
        expect(css.startsWith('@layer reset, tokens, base, components;')).toBe(true);
        for (const name of Object.keys(THEMES)) {
            expect(css).toContain(`:root[data-theme="${name}"]`);
        }
        expect(css).toContain('--trc-color-focus-ring:');
    });
});
