import type { SessionInfo } from '@trc/protocol';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { HostClient } from '../connection/host-client';

export type { SessionKey } from './workspace-model';

import {
    EMPTY_WORKSPACE,
    hostAdded,
    hostStateChanged,
    hostToggled,
    type SessionKey,
    sessionChanged,
    sessionKey,
    sessionOpened,
    sessionsListed,
    type Workspace,
} from './workspace-model';

/** The host client operations the workspace uses. */
export type WorkspaceClient = Pick<HostClient, 'connect' | 'acceptHostKey' | 'onState' | 'onMessage' | 'request'>;

/** Where sessions are shown: one terminal per session, kept alive while hidden. */
export interface TerminalHost {
    /** Shows a session's terminal and focuses it, attaching it the first time. */
    show(key: SessionKey, hostId: string, session: SessionInfo): void;
    /** Creates a session on a host at the terminal area's size. */
    create(hostId: string): Promise<SessionInfo>;
}

/** Where the daemon installs on a host unless the user picks another place (US-1.4.3). */
export const DEFAULT_INSTALL_ROOT = '~/.trc';

/**
 * Keeps the workspace read model current from the connection host, and carries out what the sidebar asks: connect
 * a host, open a session, create a session, collapse a host group (US-1.6, US-1.7, US-1.8).
 */
export class WorkspaceController {
    /** The read model the UI subscribes to. */
    readonly store: StoreApi<Workspace>;
    readonly #client: WorkspaceClient;
    readonly #terminals: TerminalHost;

    /** Creates an empty workspace. */
    constructor(client: WorkspaceClient, terminals: TerminalHost) {
        this.#client = client;
        this.#terminals = terminals;
        this.store = createStore<Workspace>(() => EMPTY_WORKSPACE);
    }

    /** Adds a host and connects it, installing the daemon under `installRoot` (US-1.4.3). */
    connect(destination: string, installRoot = DEFAULT_INSTALL_ROOT): void {
        const hostId = `host-${destination}`;
        const known = this.store.getState().hosts.some((host) => host.id === hostId);
        this.#update((workspace) => hostAdded(workspace, { id: hostId, destination }));
        if (!known) {
            this.#follow(hostId);
        }
        this.#client.connect(hostId, { destination, installRoot });
    }

    /** Trusts the host key the user confirmed (US-1.2). */
    acceptHostKey(hostId: string, fingerprint: string): void {
        this.#client.acceptHostKey(hostId, fingerprint);
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

    /** Whether a session can be created now: some host is connected. */
    canCreate(workspace: Workspace): boolean {
        return this.#targetHost(workspace) !== undefined;
    }

    /** Creates a session on the open session's host, or the first connected host, and opens it (US-1.7.1). */
    async newSession(): Promise<void> {
        const hostId = this.#targetHost(this.store.getState());
        if (hostId === undefined) {
            return;
        }
        const session = await this.#terminals.create(hostId);
        this.#update((workspace) => sessionChanged(workspace, hostId, { kind: 'created', session }));
        this.open(sessionKey(hostId, session.id));
    }

    #follow(hostId: string): void {
        this.#client.onState(hostId, (state) => {
            this.#update((workspace) => hostStateChanged(workspace, hostId, state));
            if (state.status === 'connected') {
                void this.#listSessions(hostId);
            }
        });
        this.#client.onMessage(hostId, (message) => {
            if (message.type === 'sessionEvent') {
                this.#update((workspace) => sessionChanged(workspace, hostId, message.change));
            }
        });
    }

    async #listSessions(hostId: string): Promise<void> {
        const reply = await this.#client.request(hostId, { type: 'listSessions' }).catch(() => undefined);
        if (reply?.type === 'sessions') {
            this.#update((workspace) => sessionsListed(workspace, hostId, reply.sessions));
        }
    }

    #targetHost(workspace: Workspace): string | undefined {
        const open = workspace.open === undefined ? undefined : this.#find(workspace.open);
        const connected = workspace.hosts.filter((host) => host.state.status === 'connected');
        return connected.find((host) => host.id === open?.hostId)?.id ?? connected[0]?.id;
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
