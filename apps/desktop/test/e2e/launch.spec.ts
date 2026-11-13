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

function processNames({ app }: typeof import('electron')): (string | undefined)[] {
    return app.getAppMetrics().map((metric) => metric.name);
}
