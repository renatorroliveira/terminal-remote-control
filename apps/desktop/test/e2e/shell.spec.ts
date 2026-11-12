import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { _electron as electron, expect, test } from '@playwright/test';

const electronBinary = createRequire(import.meta.url)('electron') as string;

test('the window is interactive within 2 s of launch (NFR-06)', async () => {
    const started = performance.now();
    const app = await electron.launch({ args: ['.'] });
    const window = await app.firstWindow();
    await window.getByRole('main').waitFor();
    await window.waitForFunction('document.readyState === "complete"');
    expect(performance.now() - started).toBeLessThan(2_000);
    await app.close();
});

test('follows the OS display settings and exposes the UI language (A11Y-07.3, A11Y-11.12)', async () => {
    const app = await electron.launch({ args: ['.'] });
    const window = await app.firstWindow();
    const html = window.locator('html');
    await expect(html).toHaveAttribute('data-theme', /^(light|dark|hc-light|hc-dark)$/);
    await expect(html).toHaveAttribute('data-reduced-motion', /^(true|false)$/);
    await expect(html).toHaveAttribute('lang', 'en');
    await app.close();
});

test('a second launch focuses the running app and exits (US-1.6.5)', async () => {
    const app = await electron.launch({ args: ['.'] });
    await app.firstWindow();
    const second = spawn(electronBinary, ['.'], { cwd: process.cwd(), stdio: 'ignore' });
    const code = await new Promise<number | null>((resolve) => second.on('exit', resolve));
    expect(code).toBe(0);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    await app.close();
});
