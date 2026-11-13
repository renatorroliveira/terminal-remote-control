import type { Settings } from '../../../shared/settings';
import type { TerminalAppearance } from '../../../shared/terminal-appearance';
import type { SettingsStore } from './settings-store';

/** What the terminal settings apply to: every terminal, and those created later. */
export interface TerminalSettingsTarget {
    setAppearance(appearance: TerminalAppearance): void;
    setMinimumContrast(ratio: number): void;
    setHints(on: boolean): void;
    setScrollback(lines: number): void;
}

type Applier = (settings: Settings, target: TerminalSettingsTarget) => void;

const APPLIERS: Readonly<Partial<Record<keyof Settings, Applier>>> = {
    terminalAppearance: (settings, target) => target.setAppearance(settings.terminalAppearance),
    minimumContrast: (settings, target) => target.setMinimumContrast(settings.minimumContrast),
    hints: (settings, target) => target.setHints(settings.hints),
    scrollbackLines: (settings, target) => target.setScrollback(settings.scrollbackLines),
};

/**
 * Applies the terminal settings to `target` now and after each change: appearance, contrast, hints and scrollback
 * (A11Y-01.2, A11Y-04, A11Y-07.6, A11Y-07.8, NFR-10). Returns the function that stops following them.
 */
export function applyTerminalSettings(settings: SettingsStore, target: TerminalSettingsTarget): () => void {
    for (const apply of Object.values(APPLIERS)) {
        apply(settings.current, target);
    }
    return settings.state.subscribe((now, before) => {
        for (const [key, apply] of Object.entries(APPLIERS) as [keyof Settings, Applier][]) {
            if (now[key] !== before[key]) {
                apply(now, target);
            }
        }
    });
}
