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
        const defaults = {
            theme: 'midnight',
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
        };
        expect(await config.read()).toEqual(defaults);
        expect(DEFAULT_APP_CONFIG).toEqual(defaults);
        await config.update({ theme: 'system' });
        await config.update({ sidebarWidth: 520 });
        await config.update({ sidebarCollapsed: true });
        await config.update({ screenReaderMode: 'on' });
        await config.update({ terminalZoom: 150 });
        const changed = {
            theme: 'system',
            sidebarWidth: 520,
            sidebarCollapsed: true,
            screenReaderMode: 'on',
            terminalZoom: 150,
            terminalAppearance: {
                lineHeight: 1,
                letterSpacing: 0,
                cursorStyle: 'block',
                cursorWidth: 2,
                cursorBlink: false,
            },
        };
        expect(await new AppConfigFile(directory).read()).toEqual(changed);
        expect(JSON.parse(readFileSync(join(directory, 'config.json'), 'utf8'))).toEqual(changed);
    });
});

describe('AppConfigFile: values it cannot use', () => {
    it('falls back to the default of each field it cannot use, and keeps the others', async () => {
        const directory = home();
        writeFileSync(
            join(directory, 'config.json'),
            JSON.stringify({
                theme: 'neon',
                sidebarWidth: 640,
                sidebarCollapsed: 'yes',
                screenReaderMode: 'loud',
                terminalZoom: 250,
                terminalAppearance: { lineHeight: 1.5, letterSpacing: 99, cursorStyle: 'beam', cursorBlink: true },
            }),
        );
        expect(await new AppConfigFile(directory).read()).toEqual({
            theme: 'midnight',
            sidebarWidth: 640,
            sidebarCollapsed: false,
            screenReaderMode: 'auto',
            terminalZoom: 100,
            terminalAppearance: expect.objectContaining({ cursorStyle: 'block' }),
        });
        writeFileSync(join(directory, 'config.json'), JSON.stringify({ theme: 'dark', sidebarWidth: 9000 }));
        expect(await new AppConfigFile(directory).read()).toEqual({
            theme: 'dark',
            sidebarWidth: 400,
            sidebarCollapsed: false,
            screenReaderMode: 'auto',
            terminalZoom: 100,
            terminalAppearance: expect.objectContaining({ cursorStyle: 'block' }),
        });
    });
});

describe('AppConfigFile: updates', () => {
    it('applies concurrent updates one after the other', async () => {
        const config = new AppConfigFile(home());
        await Promise.all([config.update({ theme: 'light' }), config.update({ sidebarWidth: 300 })]);
        expect(await config.read()).toEqual({
            theme: 'light',
            sidebarWidth: 300,
            sidebarCollapsed: false,
            screenReaderMode: 'auto',
            terminalZoom: 100,
            terminalAppearance: expect.objectContaining({ cursorStyle: 'block' }),
        });
    });
});

describe('AppConfigFile: terminal appearance (A11Y-07.6, A11Y-07.8, A11Y-08.1)', () => {
    it('keeps each appearance setting it can use and falls back field by field', async () => {
        const directory = home();
        writeFileSync(
            join(directory, 'config.json'),
            JSON.stringify({
                terminalAppearance: { lineHeight: 1.5, letterSpacing: 99, cursorStyle: 'beam', cursorBlink: true },
            }),
        );
        expect((await new AppConfigFile(directory).read()).terminalAppearance).toEqual({
            lineHeight: 1.5,
            letterSpacing: 0,
            cursorStyle: 'block',
            cursorWidth: 2,
            cursorBlink: true,
        });
    });
});
