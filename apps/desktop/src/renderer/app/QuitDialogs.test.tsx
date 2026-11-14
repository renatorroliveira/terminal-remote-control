import axe from 'axe-core';
import { describe, expect, it, onTestFinished } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { connectedHost, installTokens, renderApp } from './app-test-harness';

describe('Quitting (US-2.1.4, US-2.1.5)', () => {
    it('tells the user at the first quit that sessions keep running, and quits as they choose', async () => {
        await page.viewport(1400, 800);
        onTestFinished(installTokens());
        const { client, shell, quits, rendered } = renderApp();
        const screen = await rendered;
        await connectedHost(screen, client);
        shell.quit.quitRequested();
        const notice = screen.getByRole('alertdialog', { name: 'Your sessions keep running' });
        await expect.element(notice).toHaveAccessibleDescription(/keep running on their hosts after TRC quits/);
        await expect.element(notice.getByRole('button', { name: 'Quit', exact: true })).toHaveFocus();
        const results = await axe.run(document.body, {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
        });
        expect(results.violations).toEqual([]);
        await userEvent.keyboard('{Escape}');
        await expect.element(notice).not.toBeInTheDocument();
        shell.quit.quitRequested();
        await screen.getByRole('button', { name: 'Quit', exact: true }).click();
        expect(quits).toEqual(['notice', 'notice', 'quit']);
    });

    it('asks before stopping every session, with the counts, then stops them and quits', async () => {
        await page.viewport(1400, 800);
        const { client, shell, quits, rendered } = renderApp();
        const screen = await rendered;
        await connectedHost(screen, client);
        shell.run('app.quitAndStopAll');
        const confirm = screen.getByRole('alertdialog', { name: 'Stop all sessions and quit?' });
        await expect.element(confirm).toHaveAccessibleDescription(/1 session on 1 host will stop/);
        await expect.element(confirm.getByRole('button', { name: 'Cancel' })).toHaveFocus();
        await confirm.getByRole('button', { name: 'Stop Sessions and Quit' }).click();
        await expect.poll(() => quits).toEqual(['quit']);
        expect(client.requests).toContainEqual(expect.objectContaining({ type: 'stop', session: 'a' }));
    });
});
