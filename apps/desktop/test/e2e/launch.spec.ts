import { expect, test } from '@playwright/test';
import { axeViolations } from './support/axe';
import { launchApp } from './support/launch';

test('the window opens on the app scheme with an accessible main region', async () => {
    const app = await launchApp();
    const window = await app.firstWindow();

    await expect(window).toHaveTitle('Terminal Remote Control');
    expect(window.url()).toBe('app://trc/index.html');
    await expect(window.getByRole('main', { name: 'Terminal Remote Control' })).toBeVisible();
    expect(await axeViolations(window)).toEqual([]);

    await app.close();
});

test('starts the connection host as a utility process (US-1.5)', async () => {
    const app = await launchApp();
    await app.firstWindow();
    await expect.poll(() => app.evaluate(processNames)).toContain('Terminal Remote Control connection host');
    await app.close();
});

test('opens unseen and click-through in the background, and still draws every frame (D-27)', async () => {
    const app = await launchApp();
    const window = await app.firstWindow();
    await window.waitForLoadState();
    expect(await app.evaluate(backgroundState)).toEqual({ opacity: 0, focused: false, visible: true });
    expect(await window.evaluate(() => document.visibilityState)).toBe('visible');
    expect(await window.evaluate(framesIn500Ms)).toBeGreaterThan(10);
    await app.close();
});

function backgroundState({ BrowserWindow }: typeof import('electron')): Record<string, unknown> {
    const window = BrowserWindow.getAllWindows()[0];
    return { opacity: window?.getOpacity(), focused: window?.isFocused(), visible: window?.isVisible() };
}

function framesIn500Ms(): Promise<number> {
    return new Promise((done) => {
        let frames = 0;
        const started = performance.now();
        const tick = (): void => {
            frames += 1;
            if (performance.now() - started < 500) {
                requestAnimationFrame(tick);
            } else {
                done(frames);
            }
        };
        requestAnimationFrame(tick);
    });
}

function processNames({ app }: typeof import('electron')): (string | undefined)[] {
    return app.getAppMetrics().map((metric) => metric.name);
}
