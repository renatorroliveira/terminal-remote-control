import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AppConfigFile, DEFAULT_APP_CONFIG } from './app-config';

function home(): string {
    return mkdtempSync(join(tmpdir(), 'trc-home-'));
}

describe('AppConfigFile: config.json in the TRC home (P-18)', () => {
    it('defaults to Midnight and a 400 px sidebar, and keeps what the user changes', async () => {
        const directory = home();
        const config = new AppConfigFile(directory);
        expect(await config.read()).toEqual({ theme: 'midnight', sidebarWidth: 400 });
        expect(DEFAULT_APP_CONFIG).toEqual({ theme: 'midnight', sidebarWidth: 400 });
        await config.update({ theme: 'system' });
        await config.update({ sidebarWidth: 520 });
        expect(await new AppConfigFile(directory).read()).toEqual({ theme: 'system', sidebarWidth: 520 });
        expect(JSON.parse(readFileSync(join(directory, 'config.json'), 'utf8'))).toEqual({
            theme: 'system',
            sidebarWidth: 520,
        });
    });

    it('falls back to the default of each field it cannot use, and keeps the others', async () => {
        const directory = home();
        writeFileSync(join(directory, 'config.json'), JSON.stringify({ theme: 'neon', sidebarWidth: 640 }));
        expect(await new AppConfigFile(directory).read()).toEqual({ theme: 'midnight', sidebarWidth: 640 });
        writeFileSync(join(directory, 'config.json'), JSON.stringify({ theme: 'dark', sidebarWidth: 9000 }));
        expect(await new AppConfigFile(directory).read()).toEqual({ theme: 'dark', sidebarWidth: 400 });
    });

    it('applies concurrent updates one after the other', async () => {
        const config = new AppConfigFile(home());
        await Promise.all([config.update({ theme: 'light' }), config.update({ sidebarWidth: 300 })]);
        expect(await config.read()).toEqual({ theme: 'light', sidebarWidth: 300 });
    });
});
