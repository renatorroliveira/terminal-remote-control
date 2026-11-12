import { describe, expect, it } from 'vitest';
import { type DisplaySettings, themeFor } from './display';

const base: DisplaySettings = {
    colorScheme: 'light',
    highContrast: false,
    forcedColors: false,
    invertedColors: false,
    reducedTransparency: false,
    reducedMotion: false,
    differentiateWithoutColor: false,
};

describe('themeFor (A11Y-07.3)', () => {
    it('follows the OS light or dark setting and Increase Contrast', () => {
        expect(themeFor(base)).toBe('light');
        expect(themeFor({ ...base, colorScheme: 'dark' })).toBe('dark');
        expect(themeFor({ ...base, highContrast: true })).toBe('hc-light');
        expect(themeFor({ ...base, colorScheme: 'dark', highContrast: true })).toBe('hc-dark');
    });
});
