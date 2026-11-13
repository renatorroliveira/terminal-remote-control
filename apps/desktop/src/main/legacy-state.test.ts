import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrateLegacyState } from './legacy-state';

function folders() {
    const root = mkdtempSync(join(tmpdir(), 'trc-migrate-'));
    const appData = join(root, 'app-data');
    return { appData, userData: join(appData, '@trc', 'desktop'), home: join(root, 'home') };
}

const HOSTS = { hosts: [{ id: 'host-0123456789abcdef', address: { destination: 'devbox-1' }, installRoot: '~/.trc' }] };

describe('migrateLegacyState: settings and hosts from the old @trc/desktop profile move to the TRC home once', () => {
    it('copies the theme into config.json and hosts.json as is, leaving the old files in place', async () => {
        const { appData, userData, home } = folders();
        await import('node:fs/promises').then((fs) => fs.mkdir(userData, { recursive: true }));
        writeFileSync(join(userData, 'settings.json'), JSON.stringify({ theme: 'hc-dark' }));
        writeFileSync(join(userData, 'hosts.json'), JSON.stringify(HOSTS));
        await migrateLegacyState({ appData, home });
        expect(JSON.parse(readFileSync(join(home, 'config.json'), 'utf8'))).toEqual({
            theme: 'hc-dark',
            sidebarWidth: 400,
            sidebarCollapsed: false,
            screenReaderMode: 'auto',
            terminalZoom: 100,
            terminalAppearance: {
                lineHeight: 1,
                letterSpacing: 0,
                cursorStyle: 'block',
                cursorWidth: 2,
                cursorBlink: false,
            },
        });
        expect(JSON.parse(readFileSync(join(home, 'hosts.json'), 'utf8'))).toEqual(HOSTS);
        expect(statSync(join(home, 'hosts.json')).mode & 0o777).toBe(0o600);
        expect(existsSync(join(userData, 'hosts.json'))).toBe(true);
    });

    it('never replaces files the TRC home already has, and does nothing without old files', async () => {
        const { appData, userData, home } = folders();
        await import('node:fs/promises').then(async (fs) => {
            await fs.mkdir(userData, { recursive: true });
            await fs.mkdir(home, { recursive: true });
        });
        writeFileSync(join(userData, 'hosts.json'), JSON.stringify(HOSTS));
        writeFileSync(join(home, 'hosts.json'), JSON.stringify({ hosts: [] }));
        await migrateLegacyState({ appData, home });
        expect(JSON.parse(readFileSync(join(home, 'hosts.json'), 'utf8'))).toEqual({ hosts: [] });
        expect(existsSync(join(home, 'config.json'))).toBe(false);
    });
});
