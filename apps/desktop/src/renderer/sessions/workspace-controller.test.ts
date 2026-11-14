import type { ExitStatus, ServerMessage, SessionInfo } from '@trc/protocol';
import { describe, expect, it } from 'vitest';
import type { ConnectionState, ConnectTarget } from '../../shared/connection';
import type { KnownHost } from '../../shared/hosts';
import { type ClientRequest, HostRequestError } from '../connection/host-client';
import {
    type SessionPreferences,
    type TerminalHost,
    type WorkspaceClient,
    WorkspaceController,
} from './workspace-controller';
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
    /** Request types the daemon answers with an error. */
    readonly refused = new Set<string>();

    request(_hostId: string, request: ClientRequest): Promise<ServerMessage> {
        this.requests.push(request);
        if (this.refused.has(request.type)) {
            return Promise.reject(new HostRequestError('internal', 'refused'));
        }
        return Promise.resolve({ type: 'sessions', requestId: 1, sessions: [...this.listed] });
    }
}

class FakeTerminals implements TerminalHost {
    readonly reachable: string[] = [];
    readonly reattached: string[] = [];

    setHostConnected(hostId: string, connected: boolean): void {
        this.reachable.push(`${hostId}:${connected}`);
    }

    /** Sessions whose re-attach fails. */
    unattachable: string[] = [];
    /** Whether creating a session fails. */
    failCreate = false;

    reattachHost(hostId: string): Promise<readonly string[]> {
        this.reattached.push(hostId);
        return Promise.resolve(this.unattachable);
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
}

const connected: ConnectionState = { status: 'connected', daemon: { version: '0.1.0', sha256: 'ab', proto: 1 } };

function setup(preferences?: SessionPreferences) {
    const client = new FakeClient();
    const terminals = new FakeTerminals();
    const hosts = new FakeHosts();
    const workspace = new WorkspaceController(client, terminals, hosts, preferences && (() => preferences));
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
        expect(terminals.reachable).toEqual([`${host.id}:false`]);
        client.states.get(host.id)?.(connected);
        expect(terminals.reattached).toEqual([host.id, host.id]);
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
            .toMatchObject({ action: 'reattach', hostId: host.id });
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
