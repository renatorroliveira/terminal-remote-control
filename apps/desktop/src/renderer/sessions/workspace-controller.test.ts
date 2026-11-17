import type { ExitStatus, ServerMessage, SessionInfo } from '@trc/protocol';
import { describe, expect, it } from 'vitest';
import type { ConnectionState, ConnectTarget, DaemonRemoval } from '../../shared/connection';
import type { KnownHost } from '../../shared/hosts';
import type { SessionCache } from '../../shared/session-cache';
import { type ClientRequest, type ConnectOptions, HostRequestError } from '../connection/host-client';
import type { TerminalConnection } from '../terminal/terminal-view';
import {
    type AttachFailure,
    type SessionCacheStore,
    type SessionPreferences,
    type TerminalHost,
    type WorkspaceClient,
    WorkspaceController,
} from './workspace-controller';
import { hostGroups, sessionKey } from './workspace-model';
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
    readonly restored: string[] = [];
    readonly requests: ClientRequest[] = [];
    readonly states = new Map<string, (state: ConnectionState) => void>();
    readonly messages = new Map<string, (message: ServerMessage) => void>();

    connect(hostId: string, target: ConnectTarget, options?: ConnectOptions): void {
        this.targets.push([hostId, target]);
        if (options?.restore === true) {
            this.restored.push(hostId);
        }
    }

    retry(hostId: string): void {
        this.calls.push(`retry ${hostId}`);
    }

    stopRetrying(hostId: string): void {
        this.calls.push(`stop-retrying ${hostId}`);
    }

    disconnect(hostId: string): void {
        this.calls.push(`disconnect ${hostId}`);
    }

    acceptHostKey(hostId: string, fingerprint: string): void {
        this.calls.push(`accept ${hostId} ${fingerprint}`);
    }

    removal: DaemonRemoval = { kind: 'removed', kept: [] };

    removeDaemon(hostId: string, target: ConnectTarget, graceMs?: number): Promise<DaemonRemoval> {
        this.calls.push(`remove-daemon ${hostId} ${target.installRoot} ${String(graceMs)}`);
        this.states.get(hostId)?.({ status: 'closed' });
        return Promise.resolve(this.removal);
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
    /** Request types the daemon answers with an error, and the error's code. */
    readonly refused = new Set<string>();
    refusal: ConstructorParameters<typeof HostRequestError>[0] = 'internal';

    request(_hostId: string, request: ClientRequest): Promise<ServerMessage> {
        this.requests.push(request);
        if (this.refused.has(request.type)) {
            return Promise.reject(new HostRequestError(this.refusal, 'refused'));
        }
        return Promise.resolve({ type: 'sessions', requestId: 1, sessions: [...this.listed] });
    }
}

class FakeTerminals implements TerminalHost {
    readonly reachable: string[] = [];
    readonly reattached: string[] = [];

    setHostConnection(hostId: string, connection: TerminalConnection): void {
        this.reachable.push(`${hostId}:${connection}`);
    }

    /** Sessions whose re-attach fails, as the daemon no longer knows them. */
    unattachable: string[] = [];
    /** Whether creating a session fails. */
    failCreate = false;

    reattachHost(hostId: string): Promise<readonly AttachFailure[]> {
        this.reattached.push(hostId);
        const error = new HostRequestError('unknownSession', 'gone');
        return Promise.resolve(this.unattachable.map((key) => ({ key, error })));
    }

    readonly shown: string[] = [];
    readonly created: string[] = [];
    readonly closed: string[] = [];

    show(key: string): void {
        this.shown.push(key);
    }

    readonly specs: unknown[] = [];

    create(hostId: string, spec?: unknown): Promise<SessionInfo> {
        if (this.failCreate) {
            return Promise.reject(new HostRequestError('spawnFailed', 'no shell'));
        }
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

    readonly updated: string[] = [];

    updateSession(key: string, session: SessionInfo): void {
        this.updated.push(`${key} ${session.size.cols}x${session.size.rows}`);
    }
}

class FakeHosts extends FakeKnownHostStore {
    readonly hosts: KnownHost[] = [];
    /** Whether `hosts.json` refuses changes. */
    readOnly = false;

    override list(): Promise<readonly KnownHost[]> {
        return Promise.resolve(this.hosts);
    }

    override remove(id: string): Promise<void> {
        return this.readOnly ? Promise.reject(new Error('read-only')) : super.remove(id);
    }

    override setClipboardWrites(id: string, allowed: boolean): Promise<KnownHost> {
        return this.readOnly ? Promise.reject(new Error('read-only')) : super.setClipboardWrites(id, allowed);
    }

    override setDaemonRemoved(id: string, removed: boolean): Promise<KnownHost> {
        const index = this.hosts.findIndex((host) => host.id === id);
        const found = this.hosts[index];
        if (found === undefined) {
            return super.setDaemonRemoved(id, removed);
        }
        const { daemonRemoved: _previous, ...host } = found;
        const changed = removed ? { ...host, daemonRemoved: true } : host;
        this.hosts[index] = changed;
        return Promise.resolve(changed);
    }
}

const connected: ConnectionState = { status: 'connected', daemon: { version: '0.1.0', sha256: 'ab', proto: 1 } };

function setup(preferences?: SessionPreferences) {
    const client = new FakeClient();
    const terminals = new FakeTerminals();
    const hosts = new FakeHosts();
    const workspace = new WorkspaceController(
        client,
        terminals,
        hosts,
        preferences === undefined ? {} : { preferences: () => preferences },
    );
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

describe('WorkspaceController: connection loss (US-1.14)', () => {
    it('keeps a lost host’s sessions, refuses their input, and re-attaches their terminals once it reconnects', async () => {
        const { client, terminals, workspace } = setup();
        const host = await workspace.addHost('devbox-1');
        client.states.get(host.id)?.(connected);
        await expect.poll(() => workspace.store.getState().sessions.get(host.id)?.length).toBe(2);
        client.states.get(host.id)?.({ status: 'disconnected', reason: 'ping-timeout' });
        expect(workspace.store.getState().sessions.get(host.id)).toHaveLength(2);
        expect(terminals.closed).toEqual([]);
        expect(terminals.reachable).toEqual([`${host.id}:disconnected`]);
        client.states.get(host.id)?.(connected);
        expect(terminals.reattached).toEqual([host.id, host.id]);
    });
});

const lost: ConnectionState = { status: 'disconnected', reason: 'ping-timeout' };
const reconnecting = (attempt: number): ConnectionState => ({
    status: 'reconnecting',
    attempt,
    nextAttemptAt: 0,
    failure: undefined,
});

describe('WorkspaceController: reconnecting (US-2.2)', () => {
    it('shows a lost host and its sessions Reconnecting until it connects, then re-attaches them', async () => {
        const { client, terminals, workspace } = setup();
        const host = await workspace.addHost('devbox-1');
        client.states.get(host.id)?.(connected);
        await expect.poll(() => workspace.store.getState().sessions.get(host.id)?.length).toBe(2);
        client.states.get(host.id)?.(lost);
        client.states.get(host.id)?.(reconnecting(1));
        client.states.get(host.id)?.({ status: 'connecting', step: 'connecting', touch: undefined });
        const group = hostGroups(workspace.store.getState())[0];
        expect(group?.host.reconnecting).toBe(true);
        expect(group?.sessions.map((item) => item.reconnecting)).toEqual([true, true]);
        expect(terminals.reachable).toEqual([`${host.id}:disconnected`, `${host.id}:reconnecting`]);
        expect(workspace.connectionAction(group?.host ?? fail())).toBe('cancel');
        client.states.get(host.id)?.(connected);
        expect(workspace.store.getState().hosts[0]?.reconnecting).toBe(false);
        expect(terminals.reattached).toEqual([host.id, host.id]);
    });

    it('raises no dialog for a reconnection that fails, and says why in the host’s state (US-2.2.4)', async () => {
        const { client, workspace } = setup();
        const host = await workspace.addHost('devbox-1');
        workspace.toggleConnection(host.id);
        client.states.get(host.id)?.(connected);
        client.states.get(host.id)?.(lost);
        client.states.get(host.id)?.(reconnecting(1));
        client.states.get(host.id)?.({
            status: 'failed',
            failure: { kind: 'authentication', cause: 'agent-empty', details: '' },
        });
        expect(workspace.store.getState().failureNotice).toBeUndefined();
        expect(workspace.store.getState().hosts[0]?.reconnecting).toBe(false);
        expect(workspace.store.getState().hosts[0]?.state.status).toBe('failed');
    });
});

describe('WorkspaceController: stopping every session (US-2.1.4)', () => {
    async function twoHosts() {
        const { client, hosts, terminals } = setup();
        hosts.hosts.push(
            { id: 'host-a', address: { destination: 'devbox-1' }, installRoot: '~/.trc' },
            { id: 'host-b', address: { destination: 'devbox-2' }, installRoot: '~/.trc' },
        );
        const cache = {
            load: async () => ({ 'host-b': [{ id: 'old', shell: 'bash', order: 0, state: 'running' as const }] }),
            save: async () => undefined,
        };
        const workspace = new WorkspaceController(client, terminals, hosts, { cache });
        await workspace.load();
        client.listed = [info('a'), { ...info('b', 1), state: 'exited' }];
        client.states.get('host-a')?.(connected);
        await expect.poll(() => workspace.store.getState().sessions.get('host-a')?.length).toBe(2);
        return { client, workspace };
    }

    it('counts the running sessions on connected hosts, and names the hosts it cannot reach', async () => {
        const { workspace } = await twoHosts();
        expect(workspace.runningSessions()).toEqual({ sessions: 1, hosts: 1, unreachable: ['devbox-2'] });
    });

    it('stops every running session on every connected host, and names a host that refused', async () => {
        const { client, workspace } = await twoHosts();
        expect(await workspace.stopAll()).toEqual([]);
        expect(client.requests.filter((request) => request.type === 'stop')).toEqual([{ type: 'stop', session: 'a' }]);
        client.refused.add('stop');
        expect(await workspace.stopAll()).toEqual(['devbox-1']);
    });

    it('stops what each host lists now, and counts a session already gone as stopped', async () => {
        const { client, workspace } = await twoHosts();
        client.listed = [info('c')];
        expect(await workspace.stopAll()).toEqual([]);
        expect(client.requests.filter((request) => request.type === 'stop')).toEqual([{ type: 'stop', session: 'c' }]);
        client.refused.add('stop');
        client.refusal = 'unknownSession';
        expect(await workspace.stopAll()).toEqual([]);
    });
});

describe('WorkspaceController: hosts whose sessions end at logout (US-2.4.4)', () => {
    it('asks before the first session on such a host, and creates nothing when the user cancels', async () => {
        const client = new FakeClient();
        const terminals = new FakeTerminals();
        const answers = [false, true];
        const asked: string[] = [];
        const workspace = new WorkspaceController(client, terminals, new FakeHosts(), {
            confirmSessionsEndAtLogout: async (hostId) => {
                asked.push(hostId);
                return answers.shift() ?? true;
            },
        });
        const host = await workspace.addHost('devbox-1');
        client.listed = [];
        const service = { manager: 'systemd', sessionsEndAtLogout: true } as const;
        client.states.get(host.id)?.({ status: 'connected', daemon: { ...connected.daemon, proto: 2, service } });
        await workspace.newSession(host.id);
        expect(terminals.created).toEqual([]);
        await workspace.newSession(host.id);
        expect(terminals.created).toEqual([host.id]);
        await workspace.newSession(host.id);
        expect(asked).toEqual([host.id, host.id]);
    });
});

describe('WorkspaceController: shared sessions (US-2.6.3)', () => {
    it('passes every listed and changed session to its terminal, as other clients change it', async () => {
        const { client, terminals, workspace } = setup();
        const host = await workspace.addHost('devbox-1');
        client.states.get(host.id)?.(connected);
        await expect.poll(() => terminals.updated).toEqual([`${host.id}/a 120x40`, `${host.id}/b 120x40`]);
        const resized = { ...info('a'), size: { cols: 80, rows: 24 } };
        client.messages.get(host.id)?.({ type: 'sessionEvent', change: { kind: 'updated', session: resized } });
        expect(terminals.updated.at(-1)).toBe(`${host.id}/a 80x24`);
    });
});

describe('WorkspaceController: retrying (US-2.2.3, US-2.3.3)', () => {
    it('retries now, or stops retrying, per host (US-2.2.3)', async () => {
        const { client, workspace } = setup();
        const host = await workspace.addHost('devbox-1');
        client.states.get(host.id)?.(connected);
        client.states.get(host.id)?.(lost);
        client.states.get(host.id)?.(reconnecting(2));
        const entry = workspace.store.getState().hosts[0] ?? fail();
        expect(workspace.connectionAction(entry)).toBe('retry');
        workspace.toggleConnection(host.id);
        workspace.stopRetrying(host.id);
        expect(client.calls).toEqual([`retry ${host.id}`, `stop-retrying ${host.id}`]);
    });

    it('connects every known host at launch to restore it, retrying a failure (US-2.3.3)', async () => {
        const { client, hosts, workspace } = setup();
        hosts.hosts.push({ id: 'host-a', address: { destination: 'devbox-1' }, installRoot: '~/.trc' });
        await workspace.load();
        workspace.connectAll();
        expect(client.restored).toEqual(['host-a']);
    });
});

function fail(): never {
    throw new Error('missing');
}

describe('WorkspaceController: restoring at launch (US-2.3)', () => {
    const cached: SessionCache = {
        'host-a': [{ id: 'old', name: 'build', shell: 'bash', order: 0, state: 'running' }],
    };

    function restoring(cache: SessionCacheStore) {
        const client = new FakeClient();
        const terminals = new FakeTerminals();
        const hosts = new FakeHosts();
        hosts.hosts.push({ id: 'host-a', address: { destination: 'devbox-1' }, installRoot: '~/.trc' });
        const workspace = new WorkspaceController(client, terminals, hosts, { cache });
        return { client, terminals, workspace };
    }

    it('shows the sessions cached at the last run at once, Reconnecting, until their host lists its own', async () => {
        const { client, terminals, workspace } = restoring({ load: async () => cached, save: async () => undefined });
        await workspace.load();
        const items = () => hostGroups(workspace.store.getState())[0]?.sessions ?? [];
        const keys = () => items().map((item) => item.key);
        const reconnecting = () => items().some((item) => item.reconnecting);
        expect(items().map((item) => [item.label, item.reconnecting])).toEqual([['build', true]]);
        expect(terminals.reachable).toEqual(['host-a:reconnecting']);
        workspace.connectAll();
        client.states.get('host-a')?.({ status: 'connecting', step: 'connecting', touch: undefined });
        expect(items()[0]?.reconnecting).toBe(true);
        client.states.get('host-a')?.(connected);
        await expect.poll(keys).toEqual(['host-a/a', 'host-a/b']);
        expect(reconnecting()).toBe(false);
    });

    it('loads its hosts without sessions when the cache cannot be read', async () => {
        const { workspace } = restoring({
            load: () => Promise.reject(new Error('EACCES')),
            save: async () => undefined,
        });
        await workspace.load();
        expect(workspace.store.getState().hosts.map((host) => host.id)).toEqual(['host-a']);
        expect(hostGroups(workspace.store.getState())).toEqual([]);
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

    it('keeps a session that exited cleanly when auto-close is off (US-1.10.7)', async () => {
        const { client, workspace } = setup({ autoClose: false, stopGraceSeconds: 5, newSessionFolder: 'home' });
        client.listed = [exited('a', { code: 0 })];
        const host = await workspace.addHost('devbox-1');
        client.states.get(host.id)?.(connected);
        await expect.poll(() => workspace.store.getState().sessions.get(host.id)?.length).toBe(1);
        client.messages.get(host.id)?.({
            type: 'sessionEvent',
            change: { kind: 'updated', session: exited('b', { code: 0 }) },
        });
        await expect.poll(() => workspace.store.getState().sessions.get(host.id)?.length).toBe(2);
        expect(closes(client)).toEqual([]);
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
        expect(client.messages.has(host.id)).toBe(false);
        expect(client.states.has(host.id)).toBe(false);
    });

    it('keeps a host it could not forget, connected and named, and reports it (WCAG 3.3.1)', async () => {
        const { client, hosts, terminals, host, workspace } = await connectedSetup();
        hosts.readOnly = true;
        await workspace.forgetHost(host.id);
        expect(workspace.store.getState().actionFailure).toMatchObject({ action: 'forget', hostId: host.id });
        expect(workspace.store.getState().hosts.map((entry) => entry.destination)).toEqual(['devbox-1']);
        expect(workspace.store.getState().sessions.get(host.id)).toHaveLength(2);
        expect(client.calls).not.toContain(`disconnect ${host.id}`);
        expect(terminals.closed).toEqual([]);
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

describe('WorkspaceController: clipboard writes (SEC-06.1)', () => {
    it('lets a host’s programs write the clipboard, and stops them again (SEC-06.1)', async () => {
        const { workspace } = setup();
        const host = await workspace.addHost('devbox-1');
        await workspace.setClipboardWrites(host.id, true);
        expect(workspace.store.getState().hosts[0]?.allowClipboardWrites).toBe(true);
        await workspace.setClipboardWrites(host.id, false);
        expect(workspace.store.getState().hosts[0]?.allowClipboardWrites).toBeUndefined();
    });

    it('reports a clipboard change hosts.json refused, and keeps the host as it was (WCAG 3.3.1)', async () => {
        const { hosts, workspace } = setup();
        const host = await workspace.addHost('devbox-1');
        hosts.readOnly = true;
        await workspace.setClipboardWrites(host.id, true);
        expect(workspace.store.getState().actionFailure).toMatchObject({ action: 'clipboard', hostId: host.id });
        expect(workspace.store.getState().hosts[0]?.allowClipboardWrites).toBeUndefined();
    });
});

async function connectedSetup(preferences?: SessionPreferences) {
    const context = setup(preferences);
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

describe('WorkspaceController: what a session saves (US-3.2)', () => {
    it('sets what a session restores and saves, and clears its scrollback, saying whether that worked', async () => {
        const { client, host, workspace } = await connectedSetup();
        const key = `${host.id}/a`;
        await workspace.setSessionOptions(key, { restore: false, saveScrollback: true });
        expect(await workspace.clearScrollback(key)).toBe(true);
        expect(client.requests).toEqual([
            { type: 'setSessionOptions', session: 'a', options: { restore: false, saveScrollback: true } },
            { type: 'clearScrollback', session: 'a' },
        ]);
        client.refused.add('clearScrollback');
        client.refusal = 'unsupported';
        expect(await workspace.clearScrollback(key)).toBe(false);
        expect(workspace.store.getState().actionFailure).toMatchObject({
            action: 'clearScrollback',
            code: 'unsupported',
        });
    });
});

describe('WorkspaceController: managing a host’s daemon (US-3.3.2, US-3.3.3, P-45)', () => {
    const saving = { ...connected, daemon: { ...connected.daemon, proto: 3 } } as const;

    it('restarts the daemon and marks the host restarting until it connects again', async () => {
        const { client, host, workspace } = await connectedSetup();
        expect(await workspace.restartDaemon(host.id)).toBe(true);
        expect(client.requests).toEqual([{ type: 'restartDaemon' }]);
        expect(workspace.store.getState().hosts[0]?.daemonAction).toBe('restarting');
        client.states.get(host.id)?.({ status: 'disconnected', reason: 'channel-closed' });
        expect(workspace.store.getState().hosts[0]?.daemonAction).toBe('restarting');
        client.states.get(host.id)?.(connected);
        expect(workspace.store.getState().hosts[0]?.daemonAction).toBeUndefined();
        await workspace.restartDaemon(host.id);
        client.states.get(host.id)?.({ status: 'closed' });
        expect(workspace.store.getState().hosts[0]?.daemonAction).toBeUndefined();
    });

    it('removes the daemon with the stop grace period, and keeps the host as Daemon removed', async () => {
        const { client, host, workspace } = await connectedSetup({
            autoClose: false,
            stopGraceSeconds: 3,
            newSessionFolder: 'home',
        });
        client.states.get(host.id)?.(saving);
        client.requests.length = 0;
        expect(await workspace.removeDaemon(host.id)).toEqual({ kind: 'removed', kept: [] });
        expect(client.requests).toEqual([]);
        expect(client.calls).toContain(`remove-daemon ${host.id} ~/.trc 3000`);
        const removed = workspace.store.getState().hosts[0];
        expect(removed).toMatchObject({ daemonRemoved: true, state: { status: 'closed' } });
        expect(removed?.daemonAction).toBeUndefined();
        expect(workspace.store.getState().sessions.get(host.id)).toBeUndefined();
    });

    it('keeps a host whose daemon could not be removed as it was', async () => {
        const { client, workspace } = setup();
        const host = await workspace.addHost('devbox-1');
        client.removal = { kind: 'failed', failure: { kind: 'unreachable', host: 'devbox-1', port: 22, details: '' } };
        expect(await workspace.removeDaemon(host.id)).toEqual(client.removal);
        expect(client.requests).toEqual([]);
        expect(workspace.store.getState().hosts[0]?.daemonRemoved).toBeUndefined();
        expect(workspace.store.getState().hosts[0]?.daemonAction).toBeUndefined();
    });

    it('leaves a removed host out of the launch’s connections, and connects it when the user asks', async () => {
        const { client, hosts, workspace } = setup();
        hosts.hosts.push({
            id: 'host-k',
            address: { destination: 'devbox-1' },
            installRoot: '~/.trc',
            daemonRemoved: true,
        });
        await workspace.load();
        workspace.connectAll();
        expect(client.targets).toEqual([]);
        workspace.toggleConnection('host-k');
        expect(client.targets).toEqual([['host-k', { destination: 'devbox-1', installRoot: '~/.trc' }]]);
        await expect.poll(() => hosts.hosts[0]?.daemonRemoved).toBeUndefined();
        expect(workspace.store.getState().hosts[0]?.daemonRemoved).toBeUndefined();
    });

    it('upgrades the daemon by connecting again, which installs the bundled one', async () => {
        const { client, host, workspace } = await connectedSetup();
        workspace.upgradeDaemon(host.id);
        expect(client.calls).toContain(`disconnect ${host.id}`);
        expect(client.targets.at(-1)).toEqual([host.id, { destination: 'devbox-1', installRoot: '~/.trc' }]);
    });
});

describe('WorkspaceController: failed actions (US-1.10, US-1.14.3, WCAG 3.3.1)', () => {
    it('reports a session action the daemon refuses, once per failure, and keeps working', async () => {
        const { client, host, workspace } = await connectedSetup();
        client.refused.add('close');
        await workspace.closeSession(`${host.id}/a`);
        expect(workspace.store.getState().actionFailure).toEqual({
            id: 1,
            action: 'close',
            hostId: host.id,
            code: 'internal',
        });
        await workspace.closeSession(`${host.id}/a`);
        expect(workspace.store.getState().actionFailure?.id).toBe(2);
        await workspace.renameSession(`${host.id}/a`, 'logs');
        expect(workspace.store.getState().actionFailure?.id).toBe(2);
    });

    it('reports a session it could not create', async () => {
        const { terminals, host, workspace } = await connectedSetup();
        terminals.failCreate = true;
        await workspace.newSession(host.id);
        expect(workspace.store.getState().actionFailure).toMatchObject({ action: 'create', code: 'spawnFailed' });
    });

    it('reports each terminal that could not attach again after a reconnect, and closes the open one', async () => {
        const { client, terminals, host, workspace } = await connectedSetup();
        workspace.open(`${host.id}/b`);
        terminals.unattachable = [`${host.id}/b`];
        client.states.get(host.id)?.({ status: 'disconnected', reason: 'ping-timeout' });
        client.states.get(host.id)?.(connected);
        await expect
            .poll(() => workspace.store.getState().actionFailure)
            .toMatchObject({ action: 'reattach', hostId: host.id, code: 'unknownSession' });
        expect(workspace.store.getState().open).toBeUndefined();
    });

    it('reports a session that could not be opened, with the reason, and leaves nothing open (US-1.14.2)', async () => {
        const { host, workspace } = await connectedSetup();
        workspace.open(`${host.id}/a`);
        workspace.attachFailed(`${host.id}/a`, new HostRequestError('unknownSession', 'gone'));
        expect(workspace.store.getState().actionFailure).toMatchObject({
            action: 'open',
            hostId: host.id,
            code: 'unknownSession',
        });
        expect(workspace.store.getState().open).toBeUndefined();
    });
});

describe('WorkspaceController: session settings (US-1.7.1, US-1.10.2)', () => {
    it('stops with the grace period set, and starts new sessions in the open session’s folder when set', async () => {
        const { client, host, terminals, workspace } = await connectedSetup({
            autoClose: true,
            stopGraceSeconds: 12,
            newSessionFolder: 'open-session',
        });
        await workspace.stopSession(`${host.id}/a`);
        expect(client.requests).toEqual([{ type: 'stop', session: 'a', graceMs: 12_000 }]);
        client.messages.get(host.id)?.({
            type: 'sessionEvent',
            change: { kind: 'updated', session: { ...info('a'), cwd: '/srv/app' } },
        });
        workspace.open(`${host.id}/a`);
        await workspace.newSessionHere();
        expect(terminals.specs.at(-1)).toEqual({ cwd: '/srv/app' });
        await workspace.newSession(host.id);
        expect(terminals.specs.at(-1)).toBeUndefined();
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
