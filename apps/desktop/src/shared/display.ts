/** The OS display settings the main process relays to the renderer (A11Y-07.3, A11Y-08.3). */
export interface DisplaySettings {
    readonly colorScheme: 'light' | 'dark';
    /** macOS Increase Contrast, Windows high contrast. */
    readonly highContrast: boolean;
    /** Windows contrast themes (E6). */
    readonly forcedColors: boolean;
    readonly invertedColors: boolean;
    readonly reducedTransparency: boolean;
    readonly reducedMotion: boolean;
    readonly differentiateWithoutColor: boolean;
    /** The theme the user picked, or `system` to follow the OS. */
    readonly themePreference: ThemePreference;
}

/** The built-in themes: Midnight, the default, and the four that follow the OS (A11Y-07.3). */
export type ThemeName = 'midnight' | 'light' | 'dark' | 'hc-light' | 'hc-dark';

/** A theme the user picked, or `system` to follow the OS light/dark and Increase Contrast settings. */
export type ThemePreference = ThemeName | 'system';

/** The theme a new install uses. */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'midnight';

/**
 * The theme to show: the one the user picked, or, when following the system, light or dark in its high-contrast
 * variant when contrast is increased.
 */
export function themeFor(settings: DisplaySettings): ThemeName {
    if (settings.themePreference !== 'system') {
        return settings.themePreference;
    }
    if (settings.highContrast) {
        return settings.colorScheme === 'dark' ? 'hc-dark' : 'hc-light';
    }
    return settings.colorScheme;
}
