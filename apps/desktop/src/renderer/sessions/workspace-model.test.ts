import type { SessionInfo } from '@trc/protocol';
import { describe, expect, it } from 'vitest';
import {
    applySessionChange,
    EMPTY_WORKSPACE,
    failureAcknowledged,
    hostAdded,
    hostGroups,
    hostStateChanged,
    sessionChanged,
    sessionKey,
    sessionName,
    sessionsListed,
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
    it('groups sessions by host, hosts in the order added and sessions in daemon order', () => {
        const groups = hostGroups(workspaceWithTwoHosts());
        expect(groups.map((group) => [group.host.destination, group.expanded, group.sessions.length])).toEqual([
            ['devbox-1', true, 2],
            ['devbox-2:2222', true, 0],
        ]);
        expect(groups[0]?.sessions.map((item) => [item.key, item.label])).toEqual([
            [sessionKey('h1', 'a'), 'bash'],
            [sessionKey('h1', 'b'), 'bash'],
        ]);
    });

    it('shows only hosts that are connected or have sessions, and drops a closed host and its sessions', () => {
        let workspace: Workspace = { ...workspaceWithTwoHosts(), open: sessionKey('h1', 'a') };
        workspace = hostStateChanged(workspace, 'h2', { status: 'idle' });
        expect(hostGroups(workspace).map((group) => group.host.destination)).toEqual(['devbox-1']);
        workspace = hostStateChanged(workspace, 'h1', { status: 'closed' });
        expect(hostGroups(workspace)).toEqual([]);
        expect(workspace.open).toBeUndefined();
        expect(workspace.hosts).toHaveLength(2);
    });
});

describe('the workspace model: notices and closed sessions (US-1.3, US-1.10)', () => {
    it('no longer shows a session the daemon closed as open', () => {
        const open = { ...workspaceWithTwoHosts(), open: sessionKey('h1', 'a') };
        const closed = sessionChanged(open, 'h1', { kind: 'closed', sessionId: 'a' });
        expect(closed.open).toBeUndefined();
        expect(sessionChanged(open, 'h1', { kind: 'closed', sessionId: 'b' }).open).toBe(sessionKey('h1', 'a'));
    });

    it('keeps a failed connection for the user to acknowledge (US-1.3.3)', () => {
        const failed = hostStateChanged(workspaceWithTwoHosts(), 'h2', {
            status: 'failed',
            failure: { kind: 'timeout', host: 'devbox-2', port: 2222, details: 'Connection timed out' },
        });
        expect(failed.failureNotice).toBe('h2');
        expect(hostStateChanged(failed, 'h1', { status: 'idle' }).failureNotice).toBe('h2');
        expect(failureAcknowledged(failed).failureNotice).toBeUndefined();
    });

    it('raises no notice for a connection the app started on its own', () => {
        const failed = hostStateChanged(
            workspaceWithTwoHosts(),
            'h2',
            { status: 'failed', failure: { kind: 'timeout', host: 'devbox-2', port: 2222, details: '' } },
            { notifyFailure: false },
        );
        expect(failed.failureNotice).toBeUndefined();
        expect(failed.hosts[1]?.state.status).toBe('failed');
    });

    it('raises no notice when the user rejected the host key themselves', () => {
        const rejected = hostStateChanged(workspaceWithTwoHosts(), 'h2', {
            status: 'failed',
            failure: { kind: 'host-key-rejected', host: 'devbox-2', details: '' },
        });
        expect(rejected.failureNotice).toBeUndefined();
    });
});

describe('the workspace model: changes and names (US-1.6, US-1.10)', () => {
    it('marks a collapsed host, whose sessions the sidebar then hides', () => {
        const workspace = { ...workspaceWithTwoHosts(), collapsed: new Set(['h1']) };
        expect(hostGroups(workspace).map((group) => group.expanded)).toEqual([false, true]);
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
        expect(sessionName(session('a', { title: 'v\u001b[31mi\u0007m\u009b' }))).toBe('v[31mim');
        expect(sessionName(session('a'))).toBe('bash');
    });
});
