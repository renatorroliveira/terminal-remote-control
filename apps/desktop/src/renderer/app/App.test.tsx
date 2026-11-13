import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { WorkspaceController } from '../sessions/workspace-controller';
import {
    bashSession,
    FakeKnownHostStore,
    FakeTerminalHost,
    FakeWorkspaceClient,
} from '../sessions/workspace-test-doubles';
import { App } from './App';
import { AppProviders } from './AppProviders';

const CONNECTED = { status: 'connected', daemon: { version: '0.1.0', sha256: 'ab', proto: 1 } } as const;

function renderApp() {
    const client = new FakeWorkspaceClient([bashSession('a')]);
    const terminals = new FakeTerminalHost([bashSession('b')]);
    const workspace = new WorkspaceController(client, terminals, new FakeKnownHostStore());
    return {
        client,
        terminals,
        workspace,
        rendered: render(
            <AppProviders locale="en">
                <App workspace={workspace} terminals={terminals} />
            </AppProviders>,
        ),
    };
}

describe('App (US-1.6.1)', () => {
    it('has a sessions sidebar and the named main region, with nothing open yet', async () => {
        await page.viewport(1400, 800);
        const screen = await renderApp().rendered;
        await expect.element(screen.getByRole('navigation', { name: 'Sessions and hosts' })).toBeVisible();
        await expect.element(screen.getByRole('main', { name: 'Term Remote Control' })).toBeVisible();
        await expect.element(screen.getByText('No session is open.')).toBeVisible();
        await expect.element(screen.getByText('No open sessions.')).toBeVisible();
        await expect.element(screen.getByRole('button', { name: 'New session' })).toBeDisabled();
    });

    it('lists a connected host and its sessions, opens one, and creates new ones', async () => {
        await page.viewport(1400, 800);
        const { client, terminals, workspace, rendered } = renderApp();
        const screen = await rendered;
        await screen.getByRole('textbox', { name: 'New host' }).fill('devbox-1');
        await userEvent.keyboard('{Enter}');
        await screen.getByRole('button', { name: 'Connect devbox-1' }).click();
        expect(client.calls).toEqual(['connect host-0 devbox-1']);
        client.push('host-0', CONNECTED);
        await screen.getByRole('treeitem', { name: 'bash, Running' }).click();
        expect(terminals.shown).toEqual(['host-0/a']);
        await expect.element(screen.getByRole('button', { name: /^devbox-1 Host$/ })).toBeVisible();
        await screen.getByRole('button', { name: 'New session' }).click();
        await expect.poll(() => terminals.shown).toEqual(['host-0/a', 'host-0/b']);
    });

    it('keeps the sidebar 400 px wide beside the terminal area', async () => {
        await page.viewport(1400, 800);
        const screen = await renderApp().rendered;
        const sidebar = screen
            .getByRole('navigation', { name: 'Sessions and hosts' })
            .element()
            .getBoundingClientRect();
        expect(sidebar.width).toBe(400);
        await expect.element(screen.getByRole('button', { name: 'Sessions and hosts' })).not.toBeInTheDocument();
    });

    it('collapses the sidebar into a toggled panel in a narrow window (A11Y-07.5)', async () => {
        await page.viewport(320, 640);
        const screen = await renderApp().rendered;
        const toggle = screen.getByRole('button', { name: 'Sessions and hosts' });
        await expect.element(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect.element(screen.getByRole('navigation', { name: 'Sessions and hosts' })).not.toBeInTheDocument();
        await toggle.click();
        await expect.element(toggle).toHaveAttribute('aria-expanded', 'true');
        await expect.element(screen.getByRole('navigation', { name: 'Sessions and hosts' })).toBeVisible();
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
    });

    it('has no WCAG 2.2 A or AA violations', async () => {
        await page.viewport(1400, 800);
        await renderApp().rendered;
        const results = await axe.run(document.body, {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
        });
        expect(results.violations).toEqual([]);
    });
});
