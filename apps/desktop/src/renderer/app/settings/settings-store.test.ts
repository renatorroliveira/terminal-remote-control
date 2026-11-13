import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Settings } from '../../../shared/settings';
import { SettingsStore } from './settings-store';

class FakeSource {
    stored: Settings = { ...DEFAULT_SETTINGS, floodThreshold: 30 };
    readonly changes: Partial<Settings>[] = [];

    get(): Promise<Settings> {
        return Promise.resolve(this.stored);
    }

    set(change: Partial<Settings>): Promise<void> {
        this.changes.push(change);
        this.stored = { ...this.stored, ...change };
        return Promise.resolve();
    }
}

describe('SettingsStore: the settings page’s settings in the renderer (A11Y-10.3)', () => {
    it('starts at the defaults, loads what config.json holds, and keeps each change at once and on disk', async () => {
        const source = new FakeSource();
        const settings = new SettingsStore(source);
        expect(settings.current).toEqual(DEFAULT_SETTINGS);
        await settings.load();
        expect(settings.current.floodThreshold).toBe(30);
        const seen: number[] = [];
        settings.state.subscribe((state) => seen.push(state.floodThreshold));
        const saved = settings.update({ floodThreshold: 50 });
        expect(settings.current.floodThreshold).toBe(50);
        await saved;
        expect(source.changes).toEqual([{ floodThreshold: 50 }]);
        expect(seen).toEqual([50]);
    });
});
