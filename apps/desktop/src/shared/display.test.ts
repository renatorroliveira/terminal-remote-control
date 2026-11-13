import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME_PREFERENCE, type DisplaySettings, themeFor } from './display';

const base: DisplaySettings = {
    colorScheme: 'light',
    highContrast: false,
    forcedColors: false,
    invertedColors: false,
    reducedTransparency: false,
    reducedMotion: false,
    differentiateWithoutColor: false,
    themePreference: 'system',
};

describe('themeFor (A11Y-07.3)', () => {
    it('uses Midnight by default', () => {
        expect(DEFAULT_THEME_PREFERENCE).toBe('midnight');
        expect(themeFor({ ...base, themePreference: DEFAULT_THEME_PREFERENCE, colorScheme: 'dark' })).toBe('midnight');
    });

    it('follows the OS light or dark setting and Increase Contrast when matching the system', () => {
        expect(themeFor(base)).toBe('light');
        expect(themeFor({ ...base, colorScheme: 'dark' })).toBe('dark');
        expect(themeFor({ ...base, highContrast: true })).toBe('hc-light');
        expect(themeFor({ ...base, colorScheme: 'dark', highContrast: true })).toBe('hc-dark');
    });

    it('uses the theme the user picked, whatever the OS setting', () => {
        expect(themeFor({ ...base, themePreference: 'hc-light', colorScheme: 'dark' })).toBe('hc-light');
    });
});
