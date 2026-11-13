import { describe, expect, it } from 'vitest';
import { applyDisplaySettings, applyLocale } from './display';

describe('applyDisplaySettings', () => {
    it('sets the theme and every OS setting as data attributes on <html>', () => {
        const root = document.createElement('html');
        applyDisplaySettings(root, {
            colorScheme: 'dark',
            highContrast: true,
            forcedColors: false,
            invertedColors: false,
            reducedTransparency: true,
            reducedMotion: true,
            differentiateWithoutColor: false,
            themePreference: 'system',
        });
        expect(root.dataset).toMatchObject({
            theme: 'hc-dark',
            colorScheme: 'dark',
            highContrast: 'true',
            forcedColors: 'false',
            invertedColors: 'false',
            reducedTransparency: 'true',
            reducedMotion: 'true',
            differentiateWithoutColor: 'false',
        });
    });
});

describe('applyLocale (A11Y-11.12, NFR-13)', () => {
    it('exposes the UI language on <html>', () => {
        const root = document.createElement('html');
        applyLocale(root, 'en');
        expect(root.lang).toBe('en');
    });
});
