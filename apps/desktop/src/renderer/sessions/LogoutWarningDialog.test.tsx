import axe from 'axe-core';
import { describe, expect, it, onTestFinished } from 'vitest';
import { page } from 'vitest/browser';
import { connectedHost, installTokens, renderApp } from '../app/app-test-harness';

describe('LogoutWarningDialog (US-2.4.4)', () => {
    it('warns that the programs in the host’s sessions end when its last connection closes, and answers as the user chooses', async () => {
        await page.viewport(1400, 800);
        onTestFinished(installTokens());
        const { client, shell, rendered } = renderApp();
        const screen = await rendered;
        await connectedHost(screen, client);
        const created = shell.logoutWarning.ask('host-0');
        const warning = screen.getByRole('alertdialog', { name: 'Programs on devbox-1 end when you disconnect' });
        await expect.element(warning).toHaveAccessibleDescription(/ends your processes when your last connection/);
        await expect.element(warning.getByRole('button', { name: 'Create Session' })).toHaveFocus();
        const results = await axe.run(document.body, {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
        });
        expect(results.violations).toEqual([]);
        await warning.getByRole('button', { name: 'Create Session' }).click();
        expect(await created).toBe(true);
        const cancelled = shell.logoutWarning.ask('host-0');
        await screen.getByRole('button', { name: 'Cancel' }).click();
        expect(await cancelled).toBe(false);
    });
});
