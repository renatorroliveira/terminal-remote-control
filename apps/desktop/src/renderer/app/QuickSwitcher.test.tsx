import axe from 'axe-core';
import { describe, expect, it, onTestFinished } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { bashSession } from '../sessions/workspace-test-doubles';
import { connectedHost, installTokens, renderApp } from './app-test-harness';

const SESSIONS = [
    { ...bashSession('a'), customName: 'build', title: 'make -j8' },
    { ...bashSession('b'), order: 1, customName: 'logs', title: 'tail -f app.log' },
    { ...bashSession('c'), order: 2, title: 'vim notes.md' },
];

describe('QuickSwitcher: any session with one shortcut (US-5.4)', () => {
    it('lists every session, filters by name, host and title, says how many, and passes axe', async () => {
        await page.viewport(1400, 800);
        onTestFinished(installTokens());
        const { client, rendered } = renderApp(400, SESSIONS);
        const screen = await rendered;
        await connectedHost(screen, client);
        await userEvent.keyboard('{Meta>}P{/Meta}');
        const switcher = screen.getByRole('dialog', { name: 'Go to session' });
        const search = switcher.getByRole('searchbox', { name: 'Session name, host or title' });
        await expect.element(search).toHaveFocus();
        await expect.element(switcher.getByRole('status')).toHaveTextContent('3 sessions.');
        await expect.element(switcher.getByRole('option', { name: 'build, devbox-1, Running' })).toBeVisible();
        const results = await axe.run(document.body, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'] });
        expect(results.violations.map((violation) => violation.id)).toEqual([]);
        await userEvent.keyboard('tail');
        await expect.element(switcher.getByRole('status')).toHaveTextContent('1 session.');
        await expect
            .element(switcher.getByRole('option', { name: 'build, devbox-1, Running' }))
            .not.toBeInTheDocument();
        await search.fill('devbox');
        await expect.element(switcher.getByRole('status')).toHaveTextContent('3 sessions.');
        await search.fill('nothing like it');
        await expect.element(switcher.getByRole('status')).toHaveTextContent('No session matches.');
    });

    it('opens the chosen session as the session list does, and Escape goes back where focus was', async () => {
        await page.viewport(1400, 800);
        const { client, terminals, rendered } = renderApp(400, SESSIONS);
        const screen = await rendered;
        await connectedHost(screen, client);
        const field = screen.getByRole('combobox', { name: 'New host' });
        await field.click();
        await userEvent.keyboard('{Meta>}P{/Meta}');
        await userEvent.keyboard('{Escape}');
        await expect.element(screen.getByRole('dialog', { name: 'Go to session' })).not.toBeInTheDocument();
        await expect.element(field).toHaveFocus();
        await userEvent.keyboard('{Meta>}P{/Meta}');
        await userEvent.keyboard('logs');
        await userEvent.keyboard('{ArrowDown}{Enter}');
        await expect.element(screen.getByRole('dialog', { name: 'Go to session' })).not.toBeInTheDocument();
        await expect.poll(() => terminals.shown).toEqual(['host-0/b']);
    });
});
