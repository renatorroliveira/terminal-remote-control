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
