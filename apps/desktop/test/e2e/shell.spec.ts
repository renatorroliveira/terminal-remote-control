import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { shortcutKeys } from '../test-platform';
import { axeViolations } from './support/axe';
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
    const second = spawn(electronBinary, [APP_DIRECTORY, profile], {
        env: testEnvironment(),
        stdio: 'ignore',
        windowsHide: true,
    });
    const code = await new Promise<number | null>((resolve) => second.on('exit', resolve));
    expect(code).toBe(0);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    await app.close();
});

test('moves between the sidebar, terminal and status bar regions with Next region (A11Y-05.2)', async () => {
    const app = await launchApp();
    const window = await app.firstWindow();
    await window.getByRole('combobox', { name: 'New host' }).focus();
    await window.keyboard.press(shortcutKeys('region.next'));
    await expect(window.getByRole('main', { name: 'Terminal Remote Control' })).toBeFocused();
    await window.keyboard.press(shortcutKeys('region.next'));
    await expect(window.getByRole('switch', { name: 'Tab moves focus' })).toBeFocused();
    await window.keyboard.press(shortcutKeys('region.previous'));
    await expect(window.getByRole('main', { name: 'Terminal Remote Control' })).toBeFocused();
    await app.close();
});

/** The macOS Terminal menu: every Command chord shows (docs/design/keymap.md). */
const MAC_TERMINAL_MENU = [
    'Terminal',
    [
        'Tab Moves Focus Shift+Command+M',
        'Send Next Key to Terminal Shift+Command+K',
        'Mute Output Announcements Shift+Command+A',
        'List Links… Shift+Command+O',
        'Review Mode',
        'Find… Command+F',
        '',
        'Previous Command Alt+Command+Up',
        'Next Command Alt+Command+Down',
        'Read Last Command Output Alt+Command+R',
        'Select Last Command Output Alt+Command+A',
        'Copy Last Command Output Alt+Command+C',
        '',
        'Bigger Text Command+=',
        'Smaller Text Command+-',
        'Default Text Size Command+0',
    ],
];

/** The Windows Terminal menu: only Ctrl chords with a printable key show (docs/design/keymap.md, Windows rule 6). */
const WINDOWS_TERMINAL_MENU = [
    '&Terminal',
    [
        'Tab Moves Focus Control+Shift+M',
        'Send Next Key to Terminal Control+Shift+K',
        'Mute Output Announcements Control+Shift+A',
        'List Links… Control+Shift+O',
        'Review Mode',
        'Find… Control+Shift+F',
        '',
        'Previous Command',
        'Next Command',
        'Read Last Command Output Control+Shift+R',
        'Select Last Command Output',
        'Copy Last Command Output Control+Shift+Y',
        '',
        'Bigger Text Control+=',
        'Smaller Text Control+-',
        'Default Text Size Control+Shift+0',
    ],
];

test('puts the commands in the menus with the shortcuts the menus may show (docs/design/keymap.md)', async () => {
    const app = await launchApp();
    await app.firstWindow();
    const menus = await app.evaluate(({ Menu }) => {
        const label = (item: Electron.MenuItem): string => `${item.label} ${item.accelerator ?? ''}`.trim();
        return (Menu.getApplicationMenu()?.items ?? []).map((menu) => [
            menu.label,
            menu.submenu?.items.map(label) ?? [],
        ]);
    });
    expect(menus).toContainEqual(process.platform === 'darwin' ? MAC_TERMINAL_MENU : WINDOWS_TERMINAL_MENU);
    if (process.platform !== 'darwin') {
        expect(menus.map(([label]) => label)).toEqual(['&File', '&Edit', '&View', '&Terminal', '&Help']);
    }
    await app.close();
});

test('offers the SSH config hosts in Add host, read from the seam config ahead of ~/.ssh/config (US-1.1.1)', async () => {
    const config = join(mkdtempSync(join(tmpdir(), 'trc-ssh-config-')), 'ssh_config');
    writeFileSync(config, 'Host trc-suggested-host\n    HostName 127.0.0.1\n');
    const app = await launchApp([], { TRC_TEST_SSH_CONFIG: config });
    const window = await app.firstWindow();
    await window.getByRole('combobox', { name: 'New host' }).fill('trc-sugg');
    await expect(window.getByRole('option', { name: 'trc-suggested-host' })).toBeVisible();
    await app.close();
});

/** The help dialog's quick-start button on this platform and the guide heading it opens at (A11Y-10.4). */
const QUICK_START =
    process.platform === 'darwin'
        ? { button: 'VoiceOver quick start', heading: { level: 2, name: 'Quick start with VoiceOver' } }
        : {
              button: 'Screen reader quick start',
              heading: { level: 3, name: 'Quick start with NVDA, JAWS or Narrator' },
          };

test('Accessibility help lists the shortcuts, and opens the user guide in its own accessible window (A11Y-10.1, A11Y-10.4)', async () => {
    const app = await launchApp();
    const window = await app.firstWindow();
    const field = window.getByRole('combobox', { name: 'New host' });
    await field.focus();
    await window.keyboard.press(shortcutKeys('help.accessibility'));
    const help = window.getByRole('dialog', { name: 'Accessibility help' });
    await expect(help.getByRole('table', { name: 'Everywhere' })).toBeVisible();
    const helpKeys = process.platform === 'darwin' ? 'Option+F1' : 'Alt+F1';
    await expect(help.getByRole('row', { name: `Accessibility help ${helpKeys}`, exact: true })).toBeVisible();
    expect(await axeViolations(window)).toEqual([]);
    const opened = app.waitForEvent('window');
    await help.getByRole('button', { name: QUICK_START.button }).click();
    const guide = await opened;
    await expect(guide).toHaveTitle('Terminal Remote Control user guide');
    await expect(guide.getByRole('heading', QUICK_START.heading)).toBeInViewport();
    await expect(guide.getByRole('main')).toBeVisible();
    expect(await axeViolations(guide)).toEqual([]);
    await expect(help).toHaveCount(0);
    await app.close();
});

test('the Settings shortcut opens the searchable settings page, and a theme change applies and is kept (A11Y-10.3)', async () => {
    const home = mkdtempSync(join(tmpdir(), 'trc-e2e-home-'));
    const app = await launchApp([], { TRC_HOME: home });
    const window = await app.firstWindow();
    await window.getByRole('combobox', { name: 'New host' }).focus();
    await window.keyboard.press(shortcutKeys('settings.show'));
    const settings = window.getByRole('main').getByRole('region', { name: 'Settings' });
    await expect(settings.getByRole('searchbox', { name: 'Search settings' })).toBeFocused();
    expect(await axeViolations(window)).toEqual([]);
    await window.keyboard.type('theme');
    await settings.getByText('High contrast dark', { exact: true }).click();
    await expect(window.locator('html')).toHaveAttribute('data-theme', 'hc-dark');
    await expect.poll(() => JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')).theme).toBe('hc-dark');
    await window.keyboard.press('Escape');
    await window.keyboard.press('Escape');
    await expect(settings).toHaveCount(0);
    await expect(window.getByRole('combobox', { name: 'New host' })).toBeFocused();
    await app.close();
});

/** A free chord to rebind the palette to: Ctrl+Command+Y on macOS, and Ctrl+Shift+J on Windows (D-67). */
const REBINDING =
    process.platform === 'darwin'
        ? { keys: 'Control+Meta+Y', shown: 'Ctrl+Cmd+Y', accelerator: 'Control+Command+Y' }
        : { keys: 'Control+Shift+J', shown: 'Ctrl+Shift+J', accelerator: 'Control+Shift+J' };

test('rebinds a command from the settings page, and the menus and the keyboard follow (A11Y-05.7)', async () => {
    const app = await launchApp();
    const window = await app.firstWindow();
    await window.getByRole('combobox', { name: 'New host' }).focus();
    await window.keyboard.press(shortcutKeys('settings.show'));
    const settings = window.getByRole('main').getByRole('region', { name: 'Settings' });
    await settings
        .getByRole('navigation', { name: 'Settings sections' })
        .getByRole('button', { name: 'Keyboard' })
        .click();
    await settings.getByRole('button', { name: 'Change Show command palette' }).click();
    await expect(settings.getByRole('button', { name: /^Press the new shortcut/ })).toBeFocused();
    await window.keyboard.press(REBINDING.keys);
    await expect(settings.getByText(`Show command palette: ${REBINDING.shown}.`)).toBeVisible();
    await expect(settings.getByRole('button', { name: 'Change Show command palette' })).toBeFocused();
    await window.keyboard.press('Escape');
    await expect(settings).toHaveCount(0);
    const accelerator = (): Promise<string | undefined> =>
        app.evaluate(({ Menu }) => {
            const items = Menu.getApplicationMenu()?.items.flatMap((item) => item.submenu?.items ?? []) ?? [];
            return items.find((item) => item.label === 'Command Palette…')?.accelerator ?? undefined;
        });
    await expect.poll(accelerator).toBe(REBINDING.accelerator);
    await window.keyboard.press(REBINDING.keys);
    await expect(window.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
    await app.close();
});
