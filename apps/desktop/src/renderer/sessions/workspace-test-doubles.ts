import type { ServerMessage, SessionInfo } from '@trc/protocol';
import type { ConnectionState, ConnectTarget } from '../../shared/connection';
import { parseHostAddress } from '../../shared/host-address';
import { DEFAULT_INSTALL_ROOT, type KnownHost } from '../../shared/hosts';
import type { KnownHostStore, TerminalHost, WorkspaceClient } from './workspace-controller';

/** A login bash session for tests. */
export function bashSession(id: string): SessionInfo {
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
    };
}

/** A host client that records calls and lets a test push connection states. */
export class FakeWorkspaceClient implements WorkspaceClient {
    readonly calls: string[] = [];
    readonly #states = new Map<string, (state: ConnectionState) => void>();
    readonly #messages = new Map<string, (message: ServerMessage) => void>();
    readonly #sessions: readonly SessionInfo[];

    /** A client whose daemons list `sessions`. */
    constructor(sessions: readonly SessionInfo[] = []) {
        this.#sessions = sessions;
    }

    /** Pushes a connection state for a host. */
    push(hostId: string, state: ConnectionState): void {
        this.#states.get(hostId)?.(state);
    }

    /** Pushes a daemon message for a host. */
    message(hostId: string, message: ServerMessage): void {
        this.#messages.get(hostId)?.(message);
    }

    /** Records the connect. */
    connect(hostId: string, target: ConnectTarget): void {
        this.calls.push(`connect ${hostId} ${target.destination}`);
    }

    /** Records the disconnect. */
    disconnect(hostId: string): void {
        this.calls.push(`disconnect ${hostId}`);
    }

    /** Records the accepted key. */
    acceptHostKey(hostId: string, fingerprint: string): void {
        this.calls.push(`accept ${hostId} ${fingerprint}`);
    }

    /** Records the rejected key. */
    rejectHostKey(hostId: string): void {
        this.calls.push(`reject ${hostId}`);
    }

    /** Keeps the host's state listener. */
    onState(hostId: string, listener: (state: ConnectionState) => void): () => void {
        this.#states.set(hostId, listener);
        return () => this.#states.delete(hostId);
    }

    /** Keeps the host's message listener. */
    onMessage(hostId: string, listener: (message: ServerMessage) => void): () => void {
        this.#messages.set(hostId, listener);
        return () => this.#messages.delete(hostId);
    }

    /** Answers every request with the session list. */
    request(): Promise<ServerMessage> {
        return Promise.resolve({ type: 'sessions', requestId: 1, sessions: [...this.#sessions] });
    }
}

/** A terminal area that records what it shows and creates the sessions it is given. */
export class FakeTerminalHost implements TerminalHost {
    /** Ignores the element the terminals would mount in. */
    attach(): void {
        return;
    }

    readonly shown: string[] = [];
    readonly closed: string[] = [];
    readonly #created: SessionInfo[];

    /** A terminal area whose `create` returns `created` in order. */
    constructor(created: readonly SessionInfo[] = []) {
        this.#created = [...created];
    }

    /** Records the shown session. */
    show(key: string): void {
        this.shown.push(key);
    }

    /** Returns the next prepared session. */
    create(): Promise<SessionInfo> {
        const next = this.#created.shift();
        return next === undefined ? Promise.reject(new Error('no session prepared')) : Promise.resolve(next);
    }

    /** Records the closed host. */
    closeHost(hostId: string): void {
        this.closed.push(hostId);
    }

    /** Records the closed session. */
    closeSession(key: string): void {
        this.closed.push(key);
    }
}

/** A known-host store in memory, numbering hosts `host-0`, `host-1`, ... */
export class FakeKnownHostStore implements KnownHostStore {
    readonly #hosts: KnownHost[] = [];

    /** The hosts added so far. */
    list(): Promise<readonly KnownHost[]> {
        return Promise.resolve([...this.#hosts]);
    }

    /** Adds a host, or rejects an address ssh could not use. */
    add(address: string): Promise<KnownHost> {
        const parsed = parseHostAddress(address);
        if (parsed === undefined) {
            return Promise.reject(new Error('not a host address'));
        }
        const host: KnownHost = {
            id: `host-${this.#hosts.length}`,
            address: parsed,
            installRoot: DEFAULT_INSTALL_ROOT,
        };
        this.#hosts.push(host);
        return Promise.resolve(host);
    }
}
