import type { SessionInfo } from '@trc/protocol';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { TrcBridge } from '../../shared/contract';
import type { KnownHost } from '../../shared/hosts';
import type { HostClient } from '../connection/host-client';
import {
    EMPTY_WORKSPACE,
    failureAcknowledged,
    type HostEntry,
    hostAdded,
    hostStateChanged,
    hostToggled,
    isConnected,
    type SessionKey,
    sessionChanged,
    sessionKey,
    sessionOpened,
    sessionsListed,
    type Workspace,
} from './workspace-model';

export type { SessionKey } from './workspace-model';

/** The host client operations the workspace uses. */
export type WorkspaceClient = Pick<
    HostClient,
    'connect' | 'disconnect' | 'acceptHostKey' | 'rejectHostKey' | 'onState' | 'onMessage' | 'request'
>;

/** Where known hosts are kept: the main process's `hosts.json` (P-18). */
export type KnownHostStore = TrcBridge['hosts'];

/** Where sessions are shown: one terminal per session, kept alive while hidden. */
export interface TerminalHost {
    /** Shows a session's terminal and focuses it, attaching it the first time. */
    show(key: SessionKey, hostId: string, session: SessionInfo): void;
    /** Creates a session on a host at the terminal area's size. */
    create(hostId: string): Promise<SessionInfo>;
    /** Removes the terminals of a host whose connection closed. */
    closeHost(hostId: string): void;
    /** Removes the terminal of a session the daemon closed. */
    closeSession(key: SessionKey): void;
}

/** What pressing a host's connection button does now. */
export type ConnectionAction = 'connect' | 'disconnect' | 'cancel' | 'review-key';

/**
 * Keeps the workspace read model current from the connection host, and carries out what the sidebar asks: add,
 * connect and disconnect hosts, open and create sessions, collapse host groups (US-1.1, US-1.6, US-1.7, US-1.8). A
 * session whose program exits with code 0 is closed; one that failed stays, showing why (US-1.10.7).
 */
export class WorkspaceController {
    /** The read model the UI subscribes to. */
    readonly store: StoreApi<Workspace>;
    readonly #client: WorkspaceClient;
    readonly #terminals: TerminalHost;
    readonly #hosts: KnownHostStore;
    /** Hosts the app is connecting on its own, whose failures raise no dialog. */
    readonly #automatic = new Set<string>();

    /** Creates an empty workspace. */
    constructor(client: WorkspaceClient, terminals: TerminalHost, hosts: KnownHostStore) {
        this.#client = client;
        this.#terminals = terminals;
        this.#hosts = hosts;
        this.store = createStore<Workspace>(() => EMPTY_WORKSPACE);
    }

    /** Loads the known hosts, none of them connected yet. */
    async load(): Promise<void> {
        for (const host of await this.#hosts.list()) {
            this.#add(host);
        }
    }

    /** Adds a host from what the user typed; rejects an address ssh could not use (US-1.1.1). */
    async addHost(address: string): Promise<KnownHost> {
        const host = await this.#hosts.add(address);
        this.#add(host);
        return host;
    }

    /** What pressing the host's connection button does in its current state. */
    connectionAction(host: HostEntry): ConnectionAction {
        switch (host.state.status) {
            case 'connected':
                return 'disconnect';
            case 'connecting':
                return 'cancel';
            case 'host-key':
                return 'review-key';
            default:
                return 'connect';
        }
    }

    /** Connects every host that is not connected or connecting, as at launch; failures leave them disconnected. */
    connectAll(): void {
        for (const host of this.store.getState().hosts) {
            if (this.connectionAction(host) === 'connect') {
                this.#automatic.add(host.id);
                this.#client.connect(host.id, { ...host.address, installRoot: host.installRoot });
            }
        }
    }

    /** Connects a disconnected host, or disconnects or cancels a connected or connecting one. */
    toggleConnection(hostId: string): void {
        const host = this.#host(hostId);
        if (host === undefined) {
            return;
        }
        this.#automatic.delete(hostId);
        const action = this.connectionAction(host);
        if (action === 'connect') {
            this.#client.connect(host.id, { ...host.address, installRoot: host.installRoot });
        } else if (action !== 'review-key') {
            this.#client.disconnect(host.id);
        }
    }

    /** Trusts the host key the user confirmed (US-1.2). */
    acceptHostKey(hostId: string, fingerprint: string): void {
        this.#client.acceptHostKey(hostId, fingerprint);
    }

    /** Refuses the presented host key. */
    rejectHostKey(hostId: string): void {
        this.#client.rejectHostKey(hostId);
    }

    /** Closes the failure notice the user has read. */
    acknowledgeFailure(): void {
        this.#update(failureAcknowledged);
    }

    /** Shows a session in the terminal area and moves focus to it (US-1.8.1, US-1.8.3). */
    open(key: SessionKey): void {
        const found = this.#find(key);
        if (found === undefined) {
            return;
        }
        this.#update((workspace) => sessionOpened(workspace, key));
        this.#terminals.show(key, found.hostId, found.session);
    }

    /** Collapses or expands a host group. */
    toggle(hostId: string): void {
        this.#update((workspace) => hostToggled(workspace, hostId));
    }

    /** Creates a session on a connected host and opens it (US-1.7.1). */
    async newSession(hostId: string): Promise<void> {
        const host = this.#host(hostId);
        if (host === undefined || !isConnected(host)) {
            return;
        }
        const session = await this.#terminals.create(host.id);
        this.#update((workspace) => sessionChanged(workspace, host.id, { kind: 'created', session }));
        this.open(sessionKey(host.id, session.id));
    }

    #add(host: KnownHost): void {
        const known = this.#host(host.id) !== undefined;
        this.#update((workspace) => hostAdded(workspace, host));
        if (!known) {
            this.#follow(host.id);
        }
    }

    #follow(hostId: string): void {
        this.#client.onState(hostId, (state) => {
            const notifyFailure = !this.#automatic.has(hostId);
            if (state.status !== 'connecting' && state.status !== 'host-key') {
                this.#automatic.delete(hostId);
            }
            this.#update((workspace) => hostStateChanged(workspace, hostId, state, { notifyFailure }));
            if (state.status === 'connected') {
                void this.#listSessions(hostId);
            } else if (state.status === 'closed') {
                this.#terminals.closeHost(hostId);
            }
        });
        this.#client.onMessage(hostId, (message) => {
            if (message.type !== 'sessionEvent') {
                return;
            }
            this.#update((workspace) => sessionChanged(workspace, hostId, message.change));
            if (message.change.kind === 'updated') {
                this.#closeIfClean(hostId, [message.change.session]);
            } else if (message.change.kind === 'closed') {
                this.#terminals.closeSession(sessionKey(hostId, message.change.sessionId));
            }
        });
    }

    async #listSessions(hostId: string): Promise<void> {
        const reply = await this.#client.request(hostId, { type: 'listSessions' }).catch(() => undefined);
        if (reply?.type === 'sessions') {
            this.#update((workspace) => sessionsListed(workspace, hostId, reply.sessions));
            this.#closeIfClean(hostId, reply.sessions);
        }
    }

    #closeIfClean(hostId: string, sessions: readonly SessionInfo[]): void {
        for (const session of sessions.filter(exitedCleanly)) {
            this.#client.request(hostId, { type: 'close', session: session.id }).catch(() => undefined);
        }
    }

    #host(hostId: string): HostEntry | undefined {
        return this.store.getState().hosts.find((host) => host.id === hostId);
    }

    #find(key: SessionKey): { readonly hostId: string; readonly session: SessionInfo } | undefined {
        for (const [hostId, sessions] of this.store.getState().sessions) {
            const session = sessions.find((entry) => sessionKey(hostId, entry.id) === key);
            if (session !== undefined) {
                return { hostId, session };
            }
        }
        return undefined;
    }

    #update(change: (workspace: Workspace) => Workspace): void {
        this.store.setState(change(this.store.getState()), true);
    }
}

function exitedCleanly(session: SessionInfo): boolean {
    return session.state === 'exited' && session.exit?.code === 0;
}
