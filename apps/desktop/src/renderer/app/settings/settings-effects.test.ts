import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../../../shared/settings';
import { applyTerminalSettings } from './settings-effects';
import { SettingsStore } from './settings-store';

describe('applyTerminalSettings: the terminals follow the settings page (A11Y-10.3)', () => {
    it('applies the current settings, then each change, until stopped', async () => {
        let stored: Settings = { ...DEFAULT_SETTINGS, hints: false };
        const settings = new SettingsStore({
            get: () => Promise.resolve(stored),
            set: (change) => {
                stored = { ...stored, ...change };
                return Promise.resolve();
            },
        });
        const applied: string[] = [];
        const stop = applyTerminalSettings(settings, {
            setAppearance: (appearance) => applied.push(`appearance ${appearance.cursorStyle}`),
            setMinimumContrast: (ratio) => applied.push(`contrast ${ratio}`),
            setHints: (on) => applied.push(`hints ${on}`),
            setScrollback: (lines) => applied.push(`scrollback ${lines}`),
        });
        expect(applied).toEqual(['appearance block', 'contrast 4.5', 'hints true', 'scrollback 10000']);
        applied.length = 0;
        await settings.load();
        expect(applied).toEqual(['hints false']);
        await settings.update({
            minimumContrast: 7,
            terminalAppearance: { ...stored.terminalAppearance, cursorStyle: 'bar' },
        });
        expect(applied).toEqual(['hints false', 'appearance bar', 'contrast 7']);
        stop();
        await settings.update({ scrollbackLines: 20_000 });
        expect(applied).toHaveLength(3);
    });
});
