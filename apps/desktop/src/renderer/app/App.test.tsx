import axe from 'axe-core';
import { describe, expect, it, onTestFinished } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { WorkspaceController } from '../sessions/workspace-controller';
import {
    bashSession,
    FakeKnownHostStore,
    FakeTerminalHost,
    FakeWorkspaceClient,
} from '../sessions/workspace-test-doubles';
import { themeStyleSheet } from '../ui/themes';
import { App } from './App';
import { AppProviders } from './AppProviders';

const CONNECTED = { status: 'connected', daemon: { version: '0.1.0', sha256: 'ab', proto: 1 } } as const;

/** Loads the Midnight tokens, as the app does; returns their removal. */
function installTokens(): () => void {
    const tokens = document.createElement('style');
    tokens.textContent = themeStyleSheet();
    document.head.append(tokens);
    document.documentElement.dataset['theme'] = 'midnight';
    return () => {
        tokens.remove();
        delete document.documentElement.dataset['theme'];
    };
}

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

    it('shows a failed connection in a modal alert until the user presses OK (US-1.3)', async () => {
        await page.viewport(1400, 800);
        onTestFinished(installTokens());
        const { client, rendered } = renderApp();
        const screen = await rendered;
        await screen.getByRole('textbox', { name: 'New host' }).fill('devbox-1');
        await userEvent.keyboard('{Enter}');
        await screen.getByRole('button', { name: 'Connect devbox-1' }).click();
        client.push('host-0', {
            status: 'failed',
            failure: {
                kind: 'timeout',
                host: 'devbox-1',
                port: 22,
                details: 'ssh: connect to host devbox-1 port 22: Operation timed out',
            },
        });
        const alert = screen.getByRole('alertdialog', { name: 'Couldn’t connect to devbox-1' });
        await expect
            .element(alert)
            .toHaveAccessibleDescription(/didn’t answer on port 22 within 15 seconds\. .*VPN or proxy/);
        await expect
            .element(alert.getByRole('textbox', { name: 'Details' }))
            .toHaveValue('ssh: connect to host devbox-1 port 22: Operation timed out');
        await expect.element(alert.getByRole('button', { name: 'OK' })).toHaveFocus();
        const hidden = document.querySelector('nav')?.closest('[aria-hidden="true"], [inert]');
        expect(hidden?.contains(alert.element())).toBe(false);
        const results = await axe.run(document.body, {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
        });
        expect(results.violations).toEqual([]);
        await userEvent.keyboard('{Enter}');
        await expect.element(alert).not.toBeInTheDocument();
        await expect.element(screen.getByRole('button', { name: 'Connect devbox-1' })).toHaveFocus();
    });

    it('draws New session and Add host as primary buttons (Midnight: white on dark green)', async () => {
        await page.viewport(1400, 800);
        onTestFinished(installTokens());
        const screen = await renderApp().rendered;
        for (const name of ['Add host', 'New session']) {
            const style = getComputedStyle(screen.getByRole('button', { name }).element());
            expect(style.borderColor).toBe('rgb(0, 173, 44)');
        }
        const addHost = getComputedStyle(screen.getByRole('button', { name: 'Add host' }).element());
        expect([addHost.backgroundColor, addHost.color]).toEqual(['rgb(0, 77, 26)', 'rgb(255, 255, 255)']);
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
