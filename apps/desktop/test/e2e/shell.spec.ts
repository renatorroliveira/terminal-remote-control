import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { expect, test } from '@playwright/test';
import { APP_DIRECTORY, launchApp, scratchProfile, testEnvironment } from './support/launch';

const electronBinary = createRequire(import.meta.url)('electron') as string;

test('the window is interactive within 2 s of launch (NFR-06)', async () => {
    const started = performance.now();
    const app = await launchApp();
    const window = await app.firstWindow();
    await window.getByRole('main').waitFor();
    await window.waitForFunction('document.readyState === "complete"');
    expect(performance.now() - started).toBeLessThan(2_000);
    await app.close();
});

test('starts in Midnight, relays the OS display settings and exposes the UI language (A11Y-07.3, A11Y-11.12)', async () => {
    const app = await launchApp();
    const window = await app.firstWindow();
    const html = window.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'midnight');
    await expect(html).toHaveAttribute('data-reduced-motion', /^(true|false)$/);
    await expect(html).toHaveAttribute('lang', 'en');
    await app.close();
});

test('a second launch focuses the running app and exits (US-1.6.5)', async () => {
    const profile = scratchProfile();
    const app = await launchApp([profile]);
    await app.firstWindow();
    const second = spawn(electronBinary, [APP_DIRECTORY, profile], { env: testEnvironment(), stdio: 'ignore' });
    const code = await new Promise<number | null>((resolve) => second.on('exit', resolve));
    expect(code).toBe(0);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    await app.close();
});

test('moves between the sidebar, terminal and status bar regions with Command+F6 (A11Y-05.2)', async () => {
    const app = await launchApp();
    const window = await app.firstWindow();
    await window.getByRole('textbox', { name: 'New host' }).focus();
    await window.keyboard.press('Meta+F6');
    await expect(window.getByRole('main', { name: 'Terminal Remote Control' })).toBeFocused();
    await window.keyboard.press('Meta+F6');
    await expect(window.getByRole('button', { name: 'Tab moves focus' })).toBeFocused();
    await window.keyboard.press('Shift+Meta+F6');
    await expect(window.getByRole('main', { name: 'Terminal Remote Control' })).toBeFocused();
    await app.close();
});

test('puts the commands in the View and Terminal menus with their Command shortcuts (docs/design/keymap.md)', async () => {
    const app = await launchApp();
    await app.firstWindow();
    const menus = await app.evaluate(({ Menu }) => {
        const label = (item: Electron.MenuItem): string => `${item.label} ${item.accelerator ?? ''}`.trim();
        return (Menu.getApplicationMenu()?.items ?? []).map((menu) => [
            menu.label,
            menu.submenu?.items.map(label) ?? [],
        ]);
    });
    expect(menus).toContainEqual([
        'Terminal',
        [
            'Tab Moves Focus Shift+Command+M',
            'Send Next Key to Terminal Shift+Command+K',
            'Mute Output Announcements Shift+Command+A',
        ],
    ]);
    await app.close();
});
