import type { DisplaySettings } from '../shared/display';

/** The `nativeTheme` properties the relay reads. */
export interface NativeThemeView {
    readonly shouldUseDarkColors: boolean;
    readonly shouldUseHighContrastColors: boolean;
    readonly inForcedColorsMode: boolean;
    readonly shouldUseInvertedColorScheme: boolean;
    readonly prefersReducedTransparency: boolean;
    readonly shouldDifferentiateWithoutColor: boolean;
}

/** The `systemPreferences.getAnimationSettings()` field the relay reads. */
export interface AnimationView {
    readonly prefersReducedMotion: boolean;
}

/** The display settings to relay, from Electron's `nativeTheme` and animation settings. */
export function readDisplaySettings(theme: NativeThemeView, animation: AnimationView): DisplaySettings {
    return {
        colorScheme: theme.shouldUseDarkColors ? 'dark' : 'light',
        highContrast: theme.shouldUseHighContrastColors,
        forcedColors: theme.inForcedColorsMode,
        invertedColors: theme.shouldUseInvertedColorScheme,
        reducedTransparency: theme.prefersReducedTransparency,
        reducedMotion: animation.prefersReducedMotion,
        differentiateWithoutColor: theme.shouldDifferentiateWithoutColor,
    };
}
