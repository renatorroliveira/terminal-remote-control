import type { ServerMessage, SessionInfo } from '@trc/protocol';
import { describe, expect, it } from 'vitest';
import type { ConnectionState, ConnectTarget } from '../../shared/connection';
import type { ClientRequest } from '../connection/host-client';
import { type TerminalHost, type WorkspaceClient, WorkspaceController } from './workspace-controller';
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
    readonly targets: [string, ConnectTarget][] = [];
    readonly requests: ClientRequest[] = [];
    readonly states = new Map<string, (state: ConnectionState) => void>();
    readonly messages = new Map<string, (message: ServerMessage) => void>();

    connect(hostId: string, target: ConnectTarget): void {
        this.targets.push([hostId, target]);
    }

    acceptHostKey(): void {
        return;
    }

    onState(hostId: string, listener: (state: ConnectionState) => void): () => void {
        this.states.set(hostId, listener);
        return () => this.states.delete(hostId);
    }

    onMessage(hostId: string, listener: (message: ServerMessage) => void): () => void {
        this.messages.set(hostId, listener);
        return () => this.messages.delete(hostId);
    }

    request(_hostId: string, request: ClientRequest): Promise<ServerMessage> {
        this.requests.push(request);
        return Promise.resolve({ type: 'sessions', requestId: 1, sessions: [info('a'), info('b', 1)] });
    }
}

class FakeTerminals implements TerminalHost {
    readonly shown: string[] = [];
    readonly created: string[] = [];

    show(key: string): void {
        this.shown.push(key);
    }

    create(hostId: string): Promise<SessionInfo> {
        this.created.push(hostId);
        return Promise.resolve(info('c', 2));
    }
}

const connected: ConnectionState = { status: 'connected', daemon: { version: '0.1.0', sha256: 'ab', proto: 1 } };

describe('WorkspaceController (US-1.6, US-1.7, US-1.8)', () => {
    it('connects a host, lists its sessions once connected, and follows session events', async () => {
        const client = new FakeClient();
        const workspace = new WorkspaceController(client, new FakeTerminals());
        workspace.connect('devbox-1');
        expect(client.targets).toEqual([['host-devbox-1', { destination: 'devbox-1', installRoot: '~/.trc' }]]);
        client.states.get('host-devbox-1')?.(connected);
        await expect.poll(() => workspace.store.getState().sessions.get('host-devbox-1')?.length).toBe(2);
        expect(client.requests).toEqual([{ type: 'listSessions' }]);
        client.messages.get('host-devbox-1')?.({
            type: 'sessionEvent',
            change: { kind: 'closed', sessionId: 'a' },
        });
        expect(
            workspace.store
                .getState()
                .sessions.get('host-devbox-1')
                ?.map((entry) => entry.id),
        ).toEqual(['b']);
    });

    it('opens a session in the terminal area, and creates one on the open session host', async () => {
        const client = new FakeClient();
        const terminals = new FakeTerminals();
        const workspace = new WorkspaceController(client, terminals);
        workspace.connect('devbox-1');
        client.states.get('host-devbox-1')?.(connected);
        await expect.poll(() => workspace.store.getState().sessions.get('host-devbox-1')?.length).toBe(2);
        workspace.open(sessionKey('host-devbox-1', 'b'));
        expect(workspace.store.getState().open).toBe(sessionKey('host-devbox-1', 'b'));
        await workspace.newSession();
        expect(terminals.created).toEqual(['host-devbox-1']);
        expect(workspace.store.getState().open).toBe(sessionKey('host-devbox-1', 'c'));
        expect(terminals.shown).toEqual([sessionKey('host-devbox-1', 'b'), sessionKey('host-devbox-1', 'c')]);
    });

    it('has nowhere to create a session until a host is connected', async () => {
        const terminals = new FakeTerminals();
        const workspace = new WorkspaceController(new FakeClient(), terminals);
        expect(workspace.canCreate(workspace.store.getState())).toBe(false);
        await workspace.newSession();
        expect(terminals.created).toEqual([]);
    });
});
