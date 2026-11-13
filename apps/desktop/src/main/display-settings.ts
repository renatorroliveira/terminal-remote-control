import type { DisplaySettings, ThemePreference } from '../shared/display';

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

/** The display settings to relay, from Electron's `nativeTheme` and animation settings and the theme picked. */
export function readDisplaySettings(
    theme: NativeThemeView,
    animation: AnimationView,
    themePreference: ThemePreference,
): DisplaySettings {
    return {
        colorScheme: theme.shouldUseDarkColors ? 'dark' : 'light',
        highContrast: theme.shouldUseHighContrastColors,
        forcedColors: theme.inForcedColorsMode,
        invertedColors: theme.shouldUseInvertedColorScheme,
        reducedTransparency: theme.prefersReducedTransparency,
        reducedMotion: animation.prefersReducedMotion,
        differentiateWithoutColor: theme.shouldDifferentiateWithoutColor,
        themePreference,
    };
}
