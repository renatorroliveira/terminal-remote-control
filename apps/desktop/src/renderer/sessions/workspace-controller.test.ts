import type { ExitStatus, ServerMessage, SessionInfo } from '@trc/protocol';
import { describe, expect, it } from 'vitest';
import type { ConnectionState, ConnectTarget } from '../../shared/connection';
import type { KnownHost } from '../../shared/hosts';
import type { ClientRequest } from '../connection/host-client';
import { type TerminalHost, type WorkspaceClient, WorkspaceController } from './workspace-controller';
import { sessionKey } from './workspace-model';
import { FakeKnownHostStore } from './workspace-test-doubles';

const info = (id: string, order = 0): SessionInfo => ({
    id,
    order,
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
    readonly calls: string[] = [];
    readonly targets: [string, ConnectTarget][] = [];
    readonly requests: ClientRequest[] = [];
    readonly states = new Map<string, (state: ConnectionState) => void>();
    readonly messages = new Map<string, (message: ServerMessage) => void>();

    connect(hostId: string, target: ConnectTarget): void {
        this.targets.push([hostId, target]);
    }

    disconnect(hostId: string): void {
        this.calls.push(`disconnect ${hostId}`);
    }

    acceptHostKey(hostId: string, fingerprint: string): void {
        this.calls.push(`accept ${hostId} ${fingerprint}`);
    }

    rejectHostKey(hostId: string): void {
        this.calls.push(`reject ${hostId}`);
    }

    onState(hostId: string, listener: (state: ConnectionState) => void): () => void {
        this.states.set(hostId, listener);
        return () => this.states.delete(hostId);
    }

    onMessage(hostId: string, listener: (message: ServerMessage) => void): () => void {
        this.messages.set(hostId, listener);
        return () => this.messages.delete(hostId);
    }

    listed: readonly SessionInfo[] = [info('a'), info('b', 1)];

    request(_hostId: string, request: ClientRequest): Promise<ServerMessage> {
        this.requests.push(request);
        return Promise.resolve({ type: 'sessions', requestId: 1, sessions: [...this.listed] });
    }
}

class FakeTerminals implements TerminalHost {
    readonly shown: string[] = [];
    readonly created: string[] = [];
    readonly closed: string[] = [];

    show(key: string): void {
        this.shown.push(key);
    }

    readonly specs: unknown[] = [];

    create(hostId: string, spec?: unknown): Promise<SessionInfo> {
        this.created.push(hostId);
        this.specs.push(spec);
        return Promise.resolve(info('c', 2));
    }

    closeHost(hostId: string): void {
        this.closed.push(hostId);
    }

    readonly closedSessions: string[] = [];

    closeSession(key: string): void {
        this.closedSessions.push(key);
    }
}

class FakeHosts extends FakeKnownHostStore {
    readonly hosts: KnownHost[] = [];

    override list(): Promise<readonly KnownHost[]> {
        return Promise.resolve(this.hosts);
    }
}

const connected: ConnectionState = { status: 'connected', daemon: { version: '0.1.0', sha256: 'ab', proto: 1 } };

function setup() {
    const client = new FakeClient();
    const terminals = new FakeTerminals();
    const hosts = new FakeHosts();
    const workspace = new WorkspaceController(client, terminals, hosts);
    return { client, terminals, hosts, workspace };
}

describe('WorkspaceController: hosts (US-1.1, US-1.5)', () => {
    it('loads known hosts disconnected, and adds hosts the user types', async () => {
        const { hosts, workspace } = setup();
        hosts.hosts.push({ id: 'host-k', address: { destination: 'devbox-1' }, installRoot: '~/.trc' });
        await workspace.load();
        await workspace.addHost('me@build:2222');
        expect(workspace.store.getState().hosts.map((host) => [host.destination, host.state.status])).toEqual([
            ['devbox-1', 'idle'],
            ['me@build:2222', 'idle'],
        ]);
        await expect(workspace.addHost('two words')).rejects.toThrow();
    });

    it('connects, cancels and disconnects through one toggle', async () => {
        const { client, workspace } = setup();
        const host = await workspace.addHost('me@build:2222');
        workspace.toggleConnection(host.id);
        expect(client.targets).toEqual([[host.id, { destination: 'me@build', port: 2222, installRoot: '~/.trc' }]]);
        client.states.get(host.id)?.({ status: 'connecting', step: 'connecting', touch: undefined });
        workspace.toggleConnection(host.id);
        client.states.get(host.id)?.(connected);
        workspace.toggleConnection(host.id);
        expect(client.calls).toEqual([`disconnect ${host.id}`, `disconnect ${host.id}`]);
    });

    it('lists sessions once connected, and forgets them and their terminals when the connection closes', async () => {
        const { client, terminals, workspace } = setup();
        const host = await workspace.addHost('devbox-1');
        client.states.get(host.id)?.(connected);
        await expect.poll(() => workspace.store.getState().sessions.get(host.id)?.length).toBe(2);
        client.messages.get(host.id)?.({ type: 'sessionEvent', change: { kind: 'closed', sessionId: 'a' } });
        expect(
            workspace.store
                .getState()
                .sessions.get(host.id)
                ?.map((entry) => entry.id),
        ).toEqual(['b']);
        client.states.get(host.id)?.({ status: 'closed' });
        expect(workspace.store.getState().sessions.get(host.id)).toBeUndefined();
        expect(terminals.closed).toEqual([host.id]);
    });
});

describe('WorkspaceController: sessions (US-1.7, US-1.8)', () => {
    it('opens a session, and creates one on the host the user picked', async () => {
        const { client, terminals, workspace } = setup();
        const first = await workspace.addHost('devbox-1');
        const second = await workspace.addHost('devbox-2');
        client.states.get(first.id)?.(connected);
        client.states.get(second.id)?.(connected);
        await expect.poll(() => workspace.store.getState().sessions.get(second.id)?.length).toBe(2);
        workspace.open(sessionKey(second.id, 'b'));
        await workspace.newSession(first.id);
        expect(terminals.created).toEqual([first.id]);
        expect(workspace.store.getState().open).toBe(sessionKey(first.id, 'c'));
    });

    it('creates no session on a host that is not connected', async () => {
        const { terminals, workspace } = setup();
        const host = await workspace.addHost('devbox-1');
        await workspace.newSession(host.id);
        expect(terminals.created).toEqual([]);
    });
});

describe('WorkspaceController: connecting at launch', () => {
    it('connects every known host, and a failure leaves it disconnected without a dialog', async () => {
        const { client, hosts, workspace } = setup();
        hosts.hosts.push(
            { id: 'host-a', address: { destination: 'devbox-1' }, installRoot: '~/.trc' },
            { id: 'host-b', address: { destination: 'devbox-2' }, installRoot: '~/.trc' },
        );
        await workspace.load();
        workspace.connectAll();
        expect(client.targets.map(([hostId]) => hostId)).toEqual(['host-a', 'host-b']);
        client.states.get('host-a')?.({ status: 'connecting', step: 'connecting', touch: undefined });
        client.states.get('host-a')?.({
            status: 'failed',
            failure: { kind: 'timeout', host: 'devbox-1', port: 22, details: '' },
        });
        expect(workspace.store.getState().failureNotice).toBeUndefined();
        expect(workspace.store.getState().hosts[0]?.state.status).toBe('failed');
    });

    it('reports the failure of a connection the user started', async () => {
        const { client, workspace } = setup();
        const host = await workspace.addHost('devbox-1');
        workspace.connectAll();
        client.states.get(host.id)?.({ status: 'failed', failure: { kind: 'dns', host: 'devbox-1', details: '' } });
        workspace.toggleConnection(host.id);
        client.states.get(host.id)?.({ status: 'failed', failure: { kind: 'dns', host: 'devbox-1', details: '' } });
        expect(workspace.store.getState().failureNotice).toBe(host.id);
    });
});

describe('WorkspaceController: exited sessions (US-1.10.7)', () => {
    const exited = (id: string, exit: ExitStatus): SessionInfo => ({ ...info(id), state: 'exited', exit });
    const closes = (client: FakeClient) => client.requests.filter((request) => request.type === 'close');

    it('closes a session whose program exits cleanly, and keeps one that failed or was killed', async () => {
        const { client, workspace } = setup();
        const host = await workspace.addHost('devbox-1');
        client.states.get(host.id)?.(connected);
        const push = (session: SessionInfo) =>
            client.messages.get(host.id)?.({ type: 'sessionEvent', change: { kind: 'updated', session } });
        push(exited('a', { code: 0 }));
        push(exited('b', { code: 2 }));
        push(exited('c', { signal: 'SIGKILL' }));
        push({ ...info('d'), state: 'stopped' });
        expect(closes(client)).toEqual([{ type: 'close', session: 'a' }]);
    });

    it('removes the terminal of a session the daemon closed', async () => {
        const { client, terminals, workspace } = setup();
        const host = await workspace.addHost('devbox-1');
        client.states.get(host.id)?.(connected);
        client.messages.get(host.id)?.({ type: 'sessionEvent', change: { kind: 'closed', sessionId: 'a' } });
        expect(terminals.closedSessions).toEqual([sessionKey(host.id, 'a')]);
    });

    it('closes sessions that exited cleanly while the app was away', async () => {
        const { client, workspace } = setup();
        client.listed = [exited('a', { code: 0 }), exited('b', { code: 1 }), info('c')];
        const host = await workspace.addHost('devbox-1');
        client.states.get(host.id)?.(connected);
        await expect.poll(() => closes(client)).toEqual([{ type: 'close', session: 'a' }]);
    });
});

describe('WorkspaceController: forgetting, moving and testing hosts (US-1.1.5, US-1.4.3, A11Y-11.9)', () => {
    it('forgets a host: disconnects it, drops it and its sessions, and keeps the change', async () => {
        const { client, terminals, workspace } = setup();
        const host = await workspace.addHost('devbox-1');
        client.states.get(host.id)?.(connected);
        await expect.poll(() => workspace.store.getState().sessions.get(host.id)?.length).toBe(2);
        await workspace.forgetHost(host.id);
        expect(client.calls).toContain(`disconnect ${host.id}`);
        expect(workspace.store.getState().hosts).toEqual([]);
        expect(workspace.store.getState().sessions.has(host.id)).toBe(false);
        expect(terminals.closed).toContain(host.id);
    });

    it('moves a host’s install location for its next connection', async () => {
        const { client, workspace } = setup();
        const host = await workspace.addHost('devbox-1');
        await workspace.moveInstallRoot(host.id, '/scratch/trc');
        workspace.toggleConnection(host.id);
        expect(client.targets.at(-1)).toEqual([host.id, { destination: 'devbox-1', installRoot: '/scratch/trc' }]);
        await expect(workspace.moveInstallRoot(host.id, 'relative')).rejects.toThrow();
    });

    it('tests a connection: connects, reports success and disconnects again, or reports the failure', async () => {
        const { client, workspace } = setup();
        const host = await workspace.addHost('devbox-1');
        const passed = workspace.testConnection(host.id);
        client.states.get(host.id)?.({ status: 'connecting', step: 'connecting', touch: undefined });
        client.states.get(host.id)?.(connected);
        expect(await passed).toBe(true);
        expect(client.calls).toContain(`disconnect ${host.id}`);
        client.states.get(host.id)?.({ status: 'closed' });
        const failed = workspace.testConnection(host.id);
        client.states.get(host.id)?.({ status: 'failed', failure: { kind: 'dns', host: 'devbox-1', details: '' } });
        expect(await failed).toBe(false);
        expect(workspace.store.getState().failureNotice).toBe(host.id);
    });

    it('reports a test of a host that is already connected as passed, leaving it connected', async () => {
        const { client, workspace } = setup();
        const host = await workspace.addHost('devbox-1');
        client.states.get(host.id)?.(connected);
        expect(await workspace.testConnection(host.id)).toBe(true);
        expect(client.calls).not.toContain(`disconnect ${host.id}`);
    });
});

async function connectedSetup() {
    const context = setup();
    const host = await context.workspace.addHost('devbox-1');
    context.client.states.get(host.id)?.(connected);
    await expect.poll(() => context.workspace.store.getState().sessions.get(host.id)?.length).toBe(2);
    context.client.requests.length = 0;
    return { ...context, host };
}

describe('WorkspaceController: managing sessions (US-1.10)', () => {
    it('renames, stops, restarts, closes and moves a session through the daemon', async () => {
        const { client, host, workspace } = await connectedSetup();
        const key = `${host.id}/a`;
        await workspace.renameSession(key, 'logs');
        await workspace.renameSession(key, '');
        await workspace.stopSession(key);
        await workspace.restartSession(key);
        await workspace.moveSession(key, 1);
        await workspace.closeSession(key);
        expect(client.requests).toEqual([
            { type: 'rename', session: 'a', name: 'logs' },
            { type: 'rename', session: 'a' },
            { type: 'stop', session: 'a' },
            { type: 'restart', session: 'a' },
            { type: 'reorder', session: 'a', index: 1 },
            { type: 'close', session: 'a' },
        ]);
    });

    it('duplicates a session with its shell and working directory (US-1.10.5)', async () => {
        const { client, host, terminals, workspace } = await connectedSetup();
        client.listed = [{ ...info('a'), cwd: '/srv/app' }];
        client.messages.get(host.id)?.({
            type: 'sessionEvent',
            change: { kind: 'updated', session: client.listed[0] as SessionInfo },
        });
        await workspace.duplicateSession(`${host.id}/a`);
        expect(terminals.specs.at(-1)).toEqual({ profileId: 'login', cwd: '/srv/app' });
        expect(terminals.shown.at(-1)).toBe(`${host.id}/c`);
    });
});

describe('WorkspaceController: creating and switching (US-1.7, US-1.8.2)', () => {
    it('creates on the open session’s host, or the last-used host, with the options given', async () => {
        const { host, terminals, workspace } = await connectedSetup();
        await workspace.newSessionHere();
        expect(terminals.created.at(-1)).toBe(host.id);
        await workspace.newSessionWith(host.id, { profileId: 'zsh', cwd: '/tmp', name: 'scratch', env: { A: '1' } });
        expect(terminals.specs.at(-1)).toEqual({ profileId: 'zsh', cwd: '/tmp', name: 'scratch', env: { A: '1' } });
    });

    it('opens the next and previous session in list order, wrapping around', async () => {
        const { host, terminals, workspace } = await connectedSetup();
        workspace.open(`${host.id}/a`);
        workspace.openNext(1);
        workspace.openNext(1);
        workspace.openNext(-1);
        expect(terminals.shown).toEqual([`${host.id}/a`, `${host.id}/b`, `${host.id}/a`, `${host.id}/b`]);
    });
});
