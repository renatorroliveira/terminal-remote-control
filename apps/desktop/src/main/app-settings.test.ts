import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appSettingsStore, DEFAULT_APP_SETTINGS } from './app-settings';

describe('app settings (P-18)', () => {
    it('defaults to Midnight and keeps the theme the user picks', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'trc-settings-'));
        const store = appSettingsStore(directory);
        expect(await store.read()).toEqual(DEFAULT_APP_SETTINGS);
        expect(DEFAULT_APP_SETTINGS.theme).toBe('midnight');
        await store.write({ theme: 'system' });
        expect(await appSettingsStore(directory).read()).toEqual({ theme: 'system' });
    });

    it('falls back to the defaults for a theme it does not know', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'trc-settings-'));
        writeFileSync(join(directory, 'settings.json'), JSON.stringify({ theme: 'neon' }));
        expect(await appSettingsStore(directory).read()).toEqual(DEFAULT_APP_SETTINGS);
    });
});
