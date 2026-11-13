import type { ExitStatus, ServerMessage, SessionInfo } from '@trc/protocol';
import { describe, expect, it } from 'vitest';
import type { ConnectionState, ConnectTarget } from '../../shared/connection';
import { parseHostAddress } from '../../shared/host-address';
import type { KnownHost } from '../../shared/hosts';
import type { ClientRequest } from '../connection/host-client';
import {
    type KnownHostStore,
    type TerminalHost,
    type WorkspaceClient,
    WorkspaceController,
} from './workspace-controller';
import { sessionKey } from './workspace-model';

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

    create(hostId: string): Promise<SessionInfo> {
        this.created.push(hostId);
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

class FakeHosts implements KnownHostStore {
    readonly hosts: KnownHost[] = [];

    list(): Promise<readonly KnownHost[]> {
        return Promise.resolve(this.hosts);
    }

    add(address: string): Promise<KnownHost> {
        const parsed = parseHostAddress(address);
        if (parsed === undefined) {
            return Promise.reject(new Error('not a host address'));
        }
        const host = { id: `host-${this.hosts.length}`, address: parsed, installRoot: '~/.trc' };
        this.hosts.push(host);
        return Promise.resolve(host);
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
