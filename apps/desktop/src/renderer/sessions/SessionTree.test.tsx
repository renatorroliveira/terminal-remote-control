import type { SessionInfo } from '@trc/protocol';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { AppProviders } from '../app/AppProviders';
import { SessionTree } from './SessionTree';
import {
    EMPTY_WORKSPACE,
    hostAdded,
    hostStateChanged,
    sessionsListed,
    treeItems,
    type Workspace,
} from './workspace-model';

const session = (id: string, name: string, order: number, state: SessionInfo['state'] = 'running'): SessionInfo => ({
    id,
    order,
    state,
    customName: name,
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

function workspace(): Workspace {
    const connected = { status: 'connected', daemon: { version: '0.1.0', sha256: 'ab', proto: 1 } } as const;
    let next = hostAdded(EMPTY_WORKSPACE, { id: 'h1', address: { destination: 'devbox-1' }, installRoot: '~/.trc' });
    next = hostAdded(next, { id: 'h2', address: { destination: 'devbox-2' }, installRoot: '~/.trc' });
    next = hostStateChanged(next, 'h1', connected);
    next = hostStateChanged(next, 'h2', connected);
    return sessionsListed(next, 'h1', [session('a', 'build', 0), session('b', 'logs', 1, 'exited')]);
}

async function renderTree(
    onOpen: (key: string) => void = () => undefined,
    onToggle: (id: string) => void = () => undefined,
) {
    const state = workspace();
    return render(
        <AppProviders locale="en">
            <SessionTree items={treeItems(state)} open="h1/b" onOpen={onOpen} onToggle={onToggle} />
        </AppProviders>,
    );
}

describe('SessionTree (US-1.6.4, US-1.8.1, US-1.9.3)', () => {
    it('is a tree of hosts and sessions, each named with its state and placed in its set', async () => {
        const screen = await renderTree();
        const tree = screen.getByRole('tree', { name: 'Hosts and sessions' });
        await expect.element(tree).toBeVisible();
        const host = screen.getByRole('treeitem', { name: 'devbox-1, Connected' });
        await expect.element(host).toHaveAttribute('aria-level', '1');
        await expect.element(host).toHaveAttribute('aria-expanded', 'true');
        await expect.element(host).toHaveAttribute('aria-posinset', '1');
        await expect.element(host).toHaveAttribute('aria-setsize', '2');
        const logs = screen.getByRole('treeitem', { name: 'logs, Exited' });
        await expect.element(logs).toHaveAttribute('aria-level', '2');
        await expect.element(logs).toHaveAttribute('aria-posinset', '2');
        await expect.element(logs).toHaveAttribute('aria-selected', 'true');
        await expect.element(screen.getByRole('treeitem', { name: 'devbox-2, Connected' })).toBeVisible();
    });

    it('moves focus with the arrow keys, Home and End, without opening anything', async () => {
        const opened: string[] = [];
        const screen = await renderTree((key) => opened.push(key));
        await userEvent.keyboard('{Tab}');
        await expect.element(screen.getByRole('treeitem', { name: 'logs, Exited' })).toHaveFocus();
        await userEvent.keyboard('{ArrowUp}');
        await expect.element(screen.getByRole('treeitem', { name: 'build, Running' })).toHaveFocus();
        await userEvent.keyboard('{ArrowLeft}');
        await expect.element(screen.getByRole('treeitem', { name: 'devbox-1, Connected' })).toHaveFocus();
        await userEvent.keyboard('{End}');
        await expect.element(screen.getByRole('treeitem', { name: 'devbox-2, Connected' })).toHaveFocus();
        await userEvent.keyboard('{Home}');
        await expect.element(screen.getByRole('treeitem', { name: 'devbox-1, Connected' })).toHaveFocus();
        expect(opened).toEqual([]);
    });

    it('opens a session with Enter or a click, and collapses a host with Left or Enter', async () => {
        const opened: string[] = [];
        const toggled: string[] = [];
        const screen = await renderTree(
            (key) => opened.push(key),
            (id) => toggled.push(id),
        );
        await screen.getByRole('treeitem', { name: 'build, Running' }).click();
        await userEvent.keyboard('{ArrowDown}{Enter}');
        expect(opened).toEqual(['h1/a', 'h1/b']);
        await userEvent.keyboard('{Home}{ArrowLeft}');
        expect(toggled).toEqual(['h1']);
    });

    it('moves to the next row starting with a typed letter', async () => {
        const screen = await renderTree();
        await userEvent.keyboard('{Tab}');
        await userEvent.keyboard('b');
        await expect.element(screen.getByRole('treeitem', { name: 'build, Running' })).toHaveFocus();
    });

    it('has no WCAG 2.2 A or AA violations', async () => {
        await renderTree();
        const results = await axe.run(document.body, {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
        });
        expect(results.violations).toEqual([]);
    });
});
