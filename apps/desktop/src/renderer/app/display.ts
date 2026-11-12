import { type DisplaySettings, themeFor } from '../../shared/display';

/** Applies the relayed OS display settings to `<html>`: the theme, and every setting as a `data-*` attribute. */
export function applyDisplaySettings(root: HTMLElement, settings: DisplaySettings): void {
    root.dataset['theme'] = themeFor(settings);
    root.dataset['colorScheme'] = settings.colorScheme;
    root.dataset['highContrast'] = String(settings.highContrast);
    root.dataset['forcedColors'] = String(settings.forcedColors);
    root.dataset['invertedColors'] = String(settings.invertedColors);
    root.dataset['reducedTransparency'] = String(settings.reducedTransparency);
    root.dataset['reducedMotion'] = String(settings.reducedMotion);
    root.dataset['differentiateWithoutColor'] = String(settings.differentiateWithoutColor);
}

/** Exposes the UI language on `<html>` (A11Y-11.12). */
export function applyLocale(root: HTMLElement, locale: string): void {
    root.lang = locale;
}
