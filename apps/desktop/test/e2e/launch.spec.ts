import { _electron as electron, expect, test } from '@playwright/test';
import { axeViolations } from './support/axe';

test('the window opens on the app scheme with an accessible main region', async () => {
    const app = await electron.launch({ args: ['.'] });
    const window = await app.firstWindow();

    await expect(window).toHaveTitle('Term Remote Control');
    expect(window.url()).toBe('app://trc/index.html');
    await expect(window.getByRole('main', { name: 'Term Remote Control' })).toBeVisible();
    expect(await axeViolations(window)).toEqual([]);

    await app.close();
});
