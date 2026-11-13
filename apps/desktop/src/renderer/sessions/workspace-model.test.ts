import type { SessionInfo } from '@trc/protocol';
import { describe, expect, it } from 'vitest';
import {
    applySessionChange,
    EMPTY_WORKSPACE,
    hostAdded,
    hostStateChanged,
    sessionKey,
    sessionName,
    sessionsListed,
    treeItems,
    type Workspace,
} from './workspace-model';

function session(id: string, overrides: Partial<SessionInfo> = {}): SessionInfo {
    return {
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
        ...overrides,
    };
}

const connected = { status: 'connected', daemon: { version: '0.1.0', sha256: 'ab', proto: 1 } } as const;

const known = (id: string, destination: string, port?: number) => ({
    id,
    address: port === undefined ? { destination } : { destination, port },
    installRoot: '~/.trc',
});

function workspaceWithTwoHosts(): Workspace {
    let workspace = hostAdded(EMPTY_WORKSPACE, known('h1', 'devbox-1'));
    workspace = hostAdded(workspace, known('h2', 'devbox-2', 2222));
    workspace = hostStateChanged(workspace, 'h1', connected);
    workspace = hostStateChanged(workspace, 'h2', connected);
    return sessionsListed(workspace, 'h1', [session('b', { order: 1 }), session('a', { order: 0 })]);
}

describe('the workspace model (US-1.6, US-1.9)', () => {
    it('lists hosts in the order they were added, each with its sessions in daemon order', () => {
        const items = treeItems(workspaceWithTwoHosts());
        expect(items.map((item) => [item.kind, item.level, item.posinset, item.setsize, item.label])).toEqual([
            ['host', 1, 1, 2, 'devbox-1'],
            ['session', 2, 1, 2, 'bash'],
            ['session', 2, 2, 2, 'bash'],
            ['host', 1, 2, 2, 'devbox-2:2222'],
        ]);
        expect(items[1]?.key).toBe(sessionKey('h1', 'a'));
    });

    it('shows only hosts that are connected or have sessions, and drops a closed host and its sessions', () => {
        let workspace: Workspace = { ...workspaceWithTwoHosts(), open: sessionKey('h1', 'a') };
        workspace = hostStateChanged(workspace, 'h2', { status: 'idle' });
        expect(
            treeItems(workspace)
                .filter((item) => item.kind === 'host')
                .map((item) => item.label),
        ).toEqual(['devbox-1']);
        workspace = hostStateChanged(workspace, 'h1', { status: 'closed' });
        expect(treeItems(workspace)).toEqual([]);
        expect(workspace.open).toBeUndefined();
        expect(workspace.hosts).toHaveLength(2);
    });

    it('hides the sessions of a collapsed host', () => {
        const workspace = { ...workspaceWithTwoHosts(), collapsed: new Set(['h1']) };
        expect(treeItems(workspace).map((item) => item.kind)).toEqual(['host', 'host']);
    });

    it('applies created, updated, closed and reordered changes', () => {
        let sessions: readonly SessionInfo[] = [session('a', { order: 0 })];
        sessions = applySessionChange(sessions, { kind: 'created', session: session('b', { order: 1 }) });
        sessions = applySessionChange(sessions, { kind: 'created', session: session('b', { order: 1 }) });
        sessions = applySessionChange(sessions, { kind: 'updated', session: session('a', { state: 'exited' }) });
        expect(sessions.map((entry) => [entry.id, entry.state])).toEqual([
            ['a', 'exited'],
            ['b', 'running'],
        ]);
        sessions = applySessionChange(sessions, { kind: 'reordered', order: ['b', 'a'] });
        expect(sessions.map((entry) => entry.id)).toEqual(['b', 'a']);
        sessions = applySessionChange(sessions, { kind: 'closed', sessionId: 'b' });
        expect(sessions.map((entry) => entry.id)).toEqual(['a']);
    });

    it('names a session by its custom name, then the program title, then its shell', () => {
        expect(sessionName(session('a', { customName: 'build', title: 'vim' }))).toBe('build');
        expect(sessionName(session('a', { title: 'vim' }))).toBe('vim');
        expect(sessionName(session('a'))).toBe('bash');
    });
});
