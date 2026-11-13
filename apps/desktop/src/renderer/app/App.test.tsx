import type { ServerMessage, SessionInfo } from '@trc/protocol';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import type { ConnectionState } from '../../shared/connection';
import { type TerminalHost, type WorkspaceClient, WorkspaceController } from '../sessions/workspace-controller';
import { App } from './App';
import { AppProviders } from './AppProviders';

const bash = (id: string): SessionInfo => ({
    id,
    order: 0,
    state: 'running',
    profile: {
        id: 'login',
        name: 'bash',
        origin: 'login',
        kind: 'bash',
        path: '/bin/bash',
        args: [],
        login: true,
        env: {},
        integration: 'off',
    },
    size: { cols: 120, rows: 40 },
});

class FakeClient implements WorkspaceClient {
    state: (state: ConnectionState) => void = () => undefined;

    connect(): void {
        return;
    }

    acceptHostKey(): void {
        return;
    }

    onState(_hostId: string, listener: (state: ConnectionState) => void): () => void {
        this.state = listener;
        return () => undefined;
    }

    onMessage(): () => void {
        return () => undefined;
    }

    request(): Promise<ServerMessage> {
        return Promise.resolve({ type: 'sessions', requestId: 1, sessions: [bash('a')] });
    }
}

class FakeTerminals implements TerminalHost {
    readonly shown: string[] = [];

    attach(): void {
        return;
    }

    show(key: string): void {
        this.shown.push(key);
    }

    create(): Promise<SessionInfo> {
        return Promise.resolve(bash('b'));
    }
}

function renderApp() {
    const client = new FakeClient();
    const terminals = new FakeTerminals();
    const workspace = new WorkspaceController(client, terminals);
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
        await expect.element(screen.getByRole('navigation', { name: 'Sessions' })).toBeVisible();
        await expect.element(screen.getByRole('main', { name: 'Term Remote Control' })).toBeVisible();
        await expect.element(screen.getByText('No session is open.')).toBeVisible();
        await expect.element(screen.getByRole('button', { name: 'New session' })).toBeDisabled();
    });

    it('lists a connected host and its sessions, opens one, and creates new ones', async () => {
        await page.viewport(1400, 800);
        const { client, terminals, workspace, rendered } = renderApp();
        const screen = await rendered;
        workspace.connect('devbox-1');
        client.state({ status: 'connected', daemon: { version: '0.1.0', sha256: 'ab', proto: 1 } });
        await screen.getByRole('treeitem', { name: 'bash, Running' }).click();
        expect(terminals.shown).toEqual(['host-devbox-1/a']);
        await screen.getByRole('button', { name: 'New session' }).click();
        await expect.poll(() => terminals.shown).toEqual(['host-devbox-1/a', 'host-devbox-1/b']);
    });

    it('keeps the sidebar 350 px wide beside the terminal area', async () => {
        await page.viewport(1400, 800);
        const screen = await renderApp().rendered;
        const sidebar = screen.getByRole('navigation', { name: 'Sessions' }).element().getBoundingClientRect();
        expect(sidebar.width).toBe(350);
        await expect.element(screen.getByRole('button', { name: 'Sessions' })).not.toBeInTheDocument();
    });

    it('collapses the sidebar into a toggled panel in a narrow window (A11Y-07.5)', async () => {
        await page.viewport(320, 640);
        const screen = await renderApp().rendered;
        const toggle = screen.getByRole('button', { name: 'Sessions' });
        await expect.element(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect.element(screen.getByRole('navigation', { name: 'Sessions' })).not.toBeInTheDocument();
        await toggle.click();
        await expect.element(toggle).toHaveAttribute('aria-expanded', 'true');
        await expect.element(screen.getByRole('navigation', { name: 'Sessions' })).toBeVisible();
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
