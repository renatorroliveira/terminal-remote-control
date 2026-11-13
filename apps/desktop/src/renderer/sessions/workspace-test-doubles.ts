import type { ServerMessage, SessionInfo } from '@trc/protocol';
import type { ConnectionState, ConnectTarget } from '../../shared/connection';
import { parseHostAddress } from '../../shared/host-address';
import { DEFAULT_INSTALL_ROOT, isInstallRoot, type KnownHost } from '../../shared/hosts';
import type { ClientRequest } from '../connection/host-client';
import type { TerminalLink } from '../terminal/hyperlinks';
import type { KnownHostStore, SessionOptions, TerminalHost, WorkspaceClient } from './workspace-controller';

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

    /** Every request but the session list, in order. */
    readonly requests: ClientRequest[] = [];

    /** Answers the session list and profile requests, and acknowledges the rest. */
    request(_hostId: string, request: ClientRequest): Promise<ServerMessage> {
        if (request.type === 'listSessions') {
            return Promise.resolve({ type: 'sessions', requestId: 1, sessions: [...this.#sessions] });
        }
        this.requests.push(request);
        if (request.type === 'listProfiles') {
            const profiles = [bashSession('x').profile, { ...bashSession('x').profile, id: 'zsh', name: 'zsh' }];
            return Promise.resolve({ type: 'profiles', requestId: 1, profiles });
        }
        return Promise.resolve({ type: 'done', requestId: 1 });
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

    /** The options of every create, in order. */
    readonly options: (SessionOptions | undefined)[] = [];

    /** Returns the next prepared session. */
    create(_hostId: string, options?: SessionOptions): Promise<SessionInfo> {
        this.options.push(options);
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

    /** Whether Tab focus mode is on, and how often send-next-key was asked for. */
    tabFocusMode = false;
    nextKeys = 0;

    /** Reports that a terminal took focus once a session was shown. */
    focusOpen(): boolean {
        return this.shown.length > 0;
    }

    /** Records Tab focus mode. */
    setTabFocusMode(on: boolean): void {
        this.tabFocusMode = on;
    }

    /** Counts the request, when a session is shown. */
    sendNextKey(): boolean {
        this.nextKeys += this.shown.length > 0 ? 1 : 0;
        return this.shown.length > 0;
    }

    /** Never waits for a key. */
    passingNextKey(): boolean {
        return false;
    }

    /** The links the open terminal shows. */
    links: readonly TerminalLink[] = [];

    /** Returns the links set in {@link FakeTerminalHost.links}. */
    visibleLinks(): readonly TerminalLink[] {
        return this.links;
    }

    /** The terminal text size, in percent. */
    zoom = 100;

    /** Records the text size. */
    setZoom(zoom: number): void {
        this.zoom = zoom;
    }

    /** Every paste, as session and text. */
    readonly pasted: (readonly [string, string])[] = [];

    /** Records the paste. */
    paste(key: string, text: string): void {
        this.pasted.push([key, text]);
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

    /** Offers what `suggested` holds. */
    suggested: readonly string[] = [];
    suggestions(): Promise<readonly string[]> {
        return Promise.resolve(this.suggested);
    }

    /** Forgets a host. */
    remove(id: string): Promise<void> {
        const index = this.#hosts.findIndex((host) => host.id === id);
        if (index >= 0) {
            this.#hosts.splice(index, 1);
        }
        return Promise.resolve();
    }

    /** Moves a host's install location, refusing a relative one. */
    setInstallRoot(id: string, installRoot: string): Promise<KnownHost> {
        const index = this.#hosts.findIndex((host) => host.id === id);
        const host = this.#hosts[index];
        if (host === undefined || !isInstallRoot(installRoot)) {
            return Promise.reject(new Error('not an install location'));
        }
        const moved = { ...host, installRoot };
        this.#hosts[index] = moved;
        return Promise.resolve(moved);
    }
}
