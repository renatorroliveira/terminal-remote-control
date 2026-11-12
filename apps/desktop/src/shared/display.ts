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
}

/** The four built-in themes (A11Y-07.3). */
export type ThemeName = 'light' | 'dark' | 'hc-light' | 'hc-dark';

/** The theme that follows the OS: light or dark, in its high-contrast variant when contrast is increased. */
export function themeFor(settings: DisplaySettings): ThemeName {
    if (settings.highContrast) {
        return settings.colorScheme === 'dark' ? 'hc-dark' : 'hc-light';
    }
    return settings.colorScheme;
}
