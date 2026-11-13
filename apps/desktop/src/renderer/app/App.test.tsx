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

function renderApp(savedWidth = 400) {
    const client = new FakeWorkspaceClient([bashSession('a')]);
    const terminals = new FakeTerminalHost([bashSession('b')]);
    const workspace = new WorkspaceController(client, terminals, new FakeKnownHostStore());
    const saved: number[] = [];
    const sidebar = {
        width: () => Promise.resolve(savedWidth),
        setWidth: (width: number) => {
            saved.push(width);
            return Promise.resolve();
        },
    };
    return {
        client,
        terminals,
        workspace,
        saved,
        rendered: render(
            <AppProviders locale="en">
                <App workspace={workspace} terminals={terminals} sidebar={sidebar} />
            </AppProviders>,
        ),
    };
}

async function connectedHost(screen: Awaited<ReturnType<typeof renderApp>['rendered']>, client: FakeWorkspaceClient) {
    await screen.getByRole('textbox', { name: 'New host' }).fill('devbox-1');
    await userEvent.keyboard('{Enter}');
    client.push('host-0', CONNECTED);
    await expect.element(screen.getByRole('button', { name: 'New session on devbox-1' })).toBeVisible();
}

describe('App (US-1.6.1)', () => {
    it('has a sessions sidebar and the named main region, with nothing open yet', async () => {
        await page.viewport(1400, 800);
        const screen = await renderApp().rendered;
        await expect.element(screen.getByRole('navigation', { name: 'Sessions and hosts' })).toBeVisible();
        await expect.element(screen.getByRole('main', { name: 'Term Remote Control' })).toBeVisible();
        await expect.element(screen.getByText('No session is open.')).toBeVisible();
        await expect.element(screen.getByText('No open sessions.')).toBeVisible();
        await expect.element(screen.getByRole('button', { name: /^New session/ })).not.toBeInTheDocument();
    });

    it('lists a connected host and its sessions, opens one, and creates new ones', async () => {
        await page.viewport(1400, 800);
        const { client, terminals, rendered } = renderApp();
        const screen = await rendered;
        await screen.getByRole('textbox', { name: 'New host' }).fill('devbox-1');
        await userEvent.keyboard('{Enter}');
        await screen.getByRole('button', { name: 'Connect devbox-1' }).click();
        expect(client.calls).toEqual(['connect host-0 devbox-1']);
        client.push('host-0', CONNECTED);
        const host = screen.getByRole('button', { name: 'devbox-1 Connected' });
        await expect.element(host).toHaveAttribute('aria-expanded', 'true');
        await screen.getByRole('option', { name: 'bash, Running' }).click();
        expect(terminals.shown).toEqual(['host-0/a']);
        await screen.getByRole('button', { name: 'New session on devbox-1' }).click();
        await expect.poll(() => terminals.shown).toEqual(['host-0/a', 'host-0/b']);
        await host.click();
        await expect.element(host).toHaveAttribute('aria-expanded', 'false');
        await expect.element(screen.getByRole('listbox', { name: 'Sessions on devbox-1' })).not.toBeInTheDocument();
    });

    it('moves focus to a New session button when the focused session closes, so focus is never lost (A11Y-05)', async () => {
        await page.viewport(1400, 800);
        const { client, rendered } = renderApp();
        const screen = await rendered;
        await connectedHost(screen, client);
        await screen.getByRole('option', { name: 'bash, Running' }).click();
        client.message('host-0', { type: 'sessionEvent', change: { kind: 'closed', sessionId: 'a' } });
        await expect.element(screen.getByRole('button', { name: 'New session on devbox-1' })).toHaveFocus();
    });
});

describe('App: layout (US-1.6.1, A11Y-07.5)', () => {
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
});

describe('App: sidebar splitter (US-1.6.3, A11Y-05)', () => {
    const sidebarWidth = (screen: Awaited<ReturnType<typeof renderApp>['rendered']>) =>
        screen.getByRole('navigation', { name: 'Sessions and hosts' }).element().getBoundingClientRect().width;

    it('starts at the saved width and resizes from the keyboard between 300 and 800 px, saving each width', async () => {
        await page.viewport(1400, 800);
        const { saved, rendered } = renderApp(520);
        const screen = await rendered;
        const splitter = screen.getByRole('separator', { name: 'Sidebar width' });
        await expect.element(splitter).toHaveAttribute('aria-valuenow', '520');
        await expect.element(splitter).toHaveAttribute('aria-valuemin', '300');
        await expect.element(splitter).toHaveAttribute('aria-valuemax', '800');
        expect(sidebarWidth(screen)).toBe(520);
        (splitter.element() as HTMLElement).focus();
        await userEvent.keyboard('{ArrowLeft}');
        expect(sidebarWidth(screen)).toBe(510);
        await userEvent.keyboard('{End}');
        await userEvent.keyboard('{ArrowRight}');
        await userEvent.keyboard('{Home}');
        await expect.element(splitter).toHaveAttribute('aria-valuetext', '300 pixels');
        expect(saved).toEqual([510, 800, 800, 300]);
    });

    it('follows a pointer drag of the sidebar edge, and saves where the drag ends', async () => {
        await page.viewport(1400, 800);
        const { saved, rendered } = renderApp();
        const screen = await rendered;
        const splitter = screen.getByRole('separator', { name: 'Sidebar width' }).element();
        const pointer = (type: string, clientX: number) =>
            splitter.dispatchEvent(
                new PointerEvent(type, { bubbles: true, button: 0, buttons: 1, clientX, pointerId: 1 }),
            );
        pointer('pointerdown', 400);
        pointer('pointermove', 600);
        await expect.poll(() => sidebarWidth(screen)).toBe(600);
        pointer('pointermove', 950);
        pointer('pointerup', 950);
        await expect.poll(() => sidebarWidth(screen)).toBe(800);
        expect(saved).toEqual([800]);
    });
});

describe('App: failed connections (US-1.3)', () => {
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
});

describe('App: buttons (A11Y-07.1)', () => {
    it('draws Add host as a primary button (Midnight: white on dark green)', async () => {
        await page.viewport(1400, 800);
        onTestFinished(installTokens());
        const screen = await renderApp().rendered;
        const addHost = getComputedStyle(screen.getByRole('button', { name: 'Add host' }).element());
        expect([addHost.backgroundColor, addHost.color, addHost.borderColor]).toEqual([
            'rgb(0, 77, 26)',
            'rgb(255, 255, 255)',
            'rgb(0, 173, 44)',
        ]);
    });

    it('draws other buttons light on dark gray, and shows the pointer over every button', async () => {
        await page.viewport(1400, 800);
        onTestFinished(installTokens());
        const { client, rendered } = renderApp();
        const screen = await rendered;
        await connectedHost(screen, client);
        client.push('host-0', {
            status: 'host-key',
            key: { host: 'devbox-1', type: 'ssh-ed25519', key: 'AAAA', fingerprint: 'SHA256:abc' },
        });
        await expect.element(screen.getByRole('button', { name: 'Trust' })).toBeVisible();
        const trust = getComputedStyle(screen.getByRole('button', { name: 'Trust' }).element());
        expect([trust.backgroundColor, trust.color, trust.borderColor]).toEqual([
            'rgb(51, 51, 51)',
            'rgb(210, 210, 210)',
            'rgb(140, 140, 140)',
        ]);
        client.push('host-0', CONNECTED);
        await expect.element(screen.getByRole('button', { name: 'Disconnect devbox-1' })).toBeVisible();
        for (const name of ['Add host', 'Disconnect devbox-1', 'New session on devbox-1', 'devbox-1 Connected']) {
            expect(getComputedStyle(screen.getByRole('button', { name }).element()).cursor).toBe('pointer');
        }
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
