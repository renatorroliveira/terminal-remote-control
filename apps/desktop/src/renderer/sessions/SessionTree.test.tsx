import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { AppProviders } from '../app/AppProviders';
import { SessionTree } from './SessionTree';
import { WorkspaceController } from './workspace-controller';
import { bashSession, FakeKnownHostStore, FakeTerminalHost, FakeWorkspaceClient } from './workspace-test-doubles';

const CONNECTED = { status: 'connected', daemon: { version: '0.2.0', sha256: 'ab', proto: 1 } } as const;

async function renderTree() {
    const client = new FakeWorkspaceClient([
        { ...bashSession('a'), customName: 'build' },
        { ...bashSession('b'), customName: 'logs', order: 1, state: 'exited', exit: { code: 1 } },
    ]);
    const terminals = new FakeTerminalHost();
    const workspace = new WorkspaceController(client, terminals, new FakeKnownHostStore());
    await workspace.addHost('devbox-1');
    client.push('host-0', CONNECTED);
    await expect.poll(() => workspace.store.getState().sessions.get('host-0')?.length).toBe(2);
    const screen = await render(
        <AppProviders locale="en">
            <SessionTree workspace={workspace} onOpened={() => undefined} />
        </AppProviders>,
    );
    return { client, terminals, workspace, screen };
}

describe('SessionTree: the session list is a tree (US-1.6.4)', () => {
    it('nests sessions under their host with level, position and state, and one tab stop', async () => {
        const { screen } = await renderTree();
        const tree = screen.getByRole('tree', { name: 'Sessions' });
        const host = tree.getByRole('treeitem', { name: 'devbox-1, Connected' });
        await expect.element(host).toHaveAttribute('aria-level', '1');
        await expect.element(host).toHaveAttribute('aria-expanded', 'true');
        const logs = tree.getByRole('treeitem', { name: 'logs, Exited with code 1' });
        await expect.element(logs).toHaveAttribute('aria-level', '2');
        await expect.element(logs).toHaveAttribute('aria-posinset', '2');
        await expect.element(logs).toHaveAttribute('aria-setsize', '2');
        await expect.element(logs).toHaveAccessibleDescription('devbox-1');
        expect(tree.element().querySelectorAll('[tabindex="0"]')).toHaveLength(1);
        const results = await axe.run(document.body, {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
        });
        expect(results.violations).toEqual([]);
    });
});

describe('SessionTree: keys, badges and dragging (US-1.8, US-1.10.6)', () => {
    it('moves with the arrows and type-ahead without opening, and opens on Enter (US-1.8.1)', async () => {
        const { screen, terminals } = await renderTree();
        const host = screen.getByRole('treeitem', { name: 'devbox-1, Connected' });
        (host.element() as HTMLElement).focus();
        await userEvent.keyboard('{ArrowDown}');
        await expect.element(screen.getByRole('treeitem', { name: 'build, Running' })).toHaveFocus();
        await userEvent.keyboard('l');
        await expect.element(screen.getByRole('treeitem', { name: 'logs, Exited with code 1' })).toHaveFocus();
        expect(terminals.shown).toEqual([]);
        await userEvent.keyboard('{Enter}');
        expect(terminals.shown).toEqual(['host-0/b']);
        await expect
            .element(screen.getByRole('treeitem', { name: 'logs, Exited with code 1' }))
            .toHaveAttribute('aria-selected', 'true');
        await userEvent.keyboard('{ArrowLeft}');
        await expect.element(host).toHaveFocus();
        await userEvent.keyboard('{ArrowLeft}');
        await expect.element(host).toHaveAttribute('aria-expanded', 'false');
        await expect.element(screen.getByRole('treeitem', { name: 'build, Running' })).not.toBeInTheDocument();
        await userEvent.keyboard('{ArrowRight}');
        await expect.element(host).toHaveAttribute('aria-expanded', 'true');
    });
});

describe('SessionTree: states and badges (US-1.14.1, A11Y-08.2, US-1.8.3)', () => {
    it('says Disconnected for every session of a host whose connection was lost (US-1.14.1)', async () => {
        const { client, screen } = await renderTree();
        client.push('host-0', { status: 'disconnected', reason: 'ping-timeout' });
        await expect.element(screen.getByRole('treeitem', { name: 'build, Disconnected' })).toBeVisible();
        await expect.element(screen.getByRole('treeitem', { name: 'logs, Disconnected' })).toBeVisible();
    });

    it('marks a background session whose bell rang, until it opens (A11Y-08.2)', async () => {
        const { screen, workspace } = await renderTree();
        workspace.recordActivity('host-0/a');
        workspace.recordBell('host-0/a');
        await expect.element(screen.getByRole('treeitem', { name: 'build, Running, new output, bell' })).toBeVisible();
        workspace.open('host-0/a');
        await expect.element(screen.getByRole('treeitem', { name: 'build, Running' })).toBeVisible();
        workspace.recordBell('host-0/a');
        await expect.element(screen.getByRole('treeitem', { name: 'build, Running' })).toBeVisible();
    });

    it('marks a session with output the user has not seen (US-1.8.3)', async () => {
        const { screen, workspace } = await renderTree();
        workspace.recordActivity('host-0/a');
        await expect.element(screen.getByRole('treeitem', { name: 'build, Running, new output' })).toBeVisible();
        workspace.open('host-0/a');
        await expect.element(screen.getByRole('treeitem', { name: 'build, Running' })).toBeVisible();
    });

    it('reorders a session dragged onto another of its host (US-1.10.6)', async () => {
        const { client, screen } = await renderTree();
        const transfer = new DataTransfer();
        const logs = screen.getByRole('treeitem', { name: 'logs, Exited with code 1' }).element();
        const build = screen.getByRole('treeitem', { name: 'build, Running' }).element();
        logs.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
        const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer });
        build.dispatchEvent(over);
        expect(over.defaultPrevented).toBe(true);
        build.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
        await expect.poll(() => client.requests).toContainEqual({ type: 'reorder', session: 'b', index: 0 });
    });
});
