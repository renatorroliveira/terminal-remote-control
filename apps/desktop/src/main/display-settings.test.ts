import { describe, expect, it } from 'vitest';
import { readDisplaySettings } from './display-settings';

describe('readDisplaySettings', () => {
    it('maps nativeTheme and the animation settings to the relayed settings', () => {
        const settings = readDisplaySettings(
            {
                shouldUseDarkColors: true,
                shouldUseHighContrastColors: true,
                inForcedColorsMode: false,
                shouldUseInvertedColorScheme: false,
                prefersReducedTransparency: true,
                shouldDifferentiateWithoutColor: true,
            },
            { prefersReducedMotion: true },
            'midnight',
        );
        expect(settings).toEqual({
            colorScheme: 'dark',
            highContrast: true,
            forcedColors: false,
            invertedColors: false,
            reducedTransparency: true,
            reducedMotion: true,
            differentiateWithoutColor: true,
            themePreference: 'midnight',
        });
    });
});
