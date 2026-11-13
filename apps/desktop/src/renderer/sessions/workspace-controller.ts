import type { CreateSessionSpec, SessionInfo, ShellProfile } from '@trc/protocol';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { ConnectionState } from '../../shared/connection';
import type { TrcBridge } from '../../shared/contract';
import type { KnownHost } from '../../shared/hosts';
import type { Settings } from '../../shared/settings';
import { type ClientRequest, type HostClient, HostRequestError } from '../connection/host-client';
import {
    EMPTY_WORKSPACE,
    type FailedAction,
    failureAcknowledged,
    type HostEntry,
    hostAdded,
    hostGroups,
    hostRemoved,
    hostStateChanged,
    hostToggled,
    hostUpdated,
    isConnected,
    type SessionKey,
    sessionActivity,
    sessionBell,
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
    /** Creates a session on a host at the terminal area's size, with the options given. */
    create(hostId: string, options?: SessionOptions): Promise<SessionInfo>;
    /** Lets a host's terminals send input, or refuses it while the host is disconnected (US-1.14.2). */
    setHostConnected(hostId: string, connected: boolean): void;
    /**
     * Attaches a reconnected host's terminals to their sessions again; each takes input once attached, and the
     * sessions that could not attach are returned (US-1.14.2, US-1.14.3).
     */
    reattachHost(hostId: string): Promise<readonly SessionKey[]>;
    /** Removes the terminals of a host whose connection closed. */
    closeHost(hostId: string): void;
    /** Removes the terminal of a session the daemon closed. */
    closeSession(key: SessionKey): void;
}

/** The settings that change how sessions start, stop and end (US-1.7.1, US-1.10.2, US-1.10.7). */
export type SessionPreferences = Pick<Settings, 'autoClose' | 'stopGraceSeconds' | 'newSessionFolder'>;

/** What a new session may set beyond its size (US-1.7.2). */
export type SessionOptions = Partial<Pick<CreateSessionSpec, 'profileId' | 'cwd' | 'name' | 'env'>>;

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
    readonly #preferences: (() => SessionPreferences) | undefined;
    /** Hosts the app is connecting on its own, whose failures raise no dialog. */
    readonly #automatic = new Set<string>();
    /** Connection tests waiting for their host to connect or fail (US-1.1.5). */
    readonly #tests = new Map<string, (passed: boolean) => void>();
    /** Hosts the user forgot, whose late state changes are ignored. */
    readonly #forgotten = new Set<string>();
    /** The host a session was last opened or created on (US-1.7.1). */
    #lastHost: string | undefined;

    /** Creates an empty workspace; without `preferences`, the daemon's defaults and auto-close apply. */
    constructor(
        client: WorkspaceClient,
        terminals: TerminalHost,
        hosts: KnownHostStore,
        preferences?: () => SessionPreferences,
    ) {
        this.#client = client;
        this.#terminals = terminals;
        this.#hosts = hosts;
        this.#preferences = preferences;
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

    /** Addresses Add host offers: recent ones, then the user's SSH configuration (US-1.1.1). */
    suggestions(): Promise<readonly string[]> {
        return this.#hosts.suggestions();
    }

    /** Forgets a host: closes its connection and drops it and its sessions from the app (A11Y-11.9). */
    async forgetHost(hostId: string): Promise<void> {
        const host = this.#host(hostId);
        if (host === undefined) {
            return;
        }
        if (this.connectionAction(host) !== 'connect') {
            this.#client.disconnect(hostId);
        }
        this.#forgotten.add(hostId);
        this.#terminals.closeHost(hostId);
        this.#update((workspace) => hostRemoved(workspace, hostId));
        await this.#attempt('forget', hostId, () => this.#hosts.remove(hostId));
    }

    /** Moves a host's install location; the next connection uses it (US-1.4.3). */
    async moveInstallRoot(hostId: string, installRoot: string): Promise<void> {
        const moved = await this.#hosts.setInstallRoot(hostId, installRoot);
        this.#update((workspace) => hostUpdated(workspace, moved));
    }

    /** Lets a host's programs write the clipboard with OSC 52, or stops them (SEC-06.1). */
    async setClipboardWrites(hostId: string, allowed: boolean): Promise<void> {
        const changed = await this.#hosts.setClipboardWrites(hostId, allowed);
        this.#update((workspace) => hostUpdated(workspace, changed));
    }

    /**
     * Tests a host's connection (US-1.1.5): true at once when it is connected; otherwise it connects, and resolves
     * true and disconnects again once connected, or false when the connection fails, which the failure dialog
     * explains.
     */
    testConnection(hostId: string): Promise<boolean> {
        const host = this.#host(hostId);
        if (host === undefined || this.connectionAction(host) !== 'connect') {
            return Promise.resolve(host !== undefined && isConnected(host));
        }
        const result = new Promise<boolean>((resolve) => this.#tests.set(hostId, resolve));
        this.toggleConnection(hostId);
        return result;
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
        this.#lastHost = found.hostId;
        this.#update((workspace) => sessionOpened(workspace, key));
        this.#terminals.show(key, found.hostId, found.session);
    }

    /** Records a session's bell, which badges it unless it is open (A11Y-08.2). */
    recordBell(key: SessionKey): void {
        const before = this.store.getState();
        const after = sessionBell(before, key);
        if (after !== before) {
            this.store.setState(after, true);
        }
    }

    /** Notes output in a session, which has unread output unless it is open (US-1.8.3). */
    recordActivity(key: SessionKey): void {
        const before = this.store.getState();
        const after = sessionActivity(before, key);
        if (after !== before) {
            this.store.setState(after, true);
        }
    }

    /** Opens the session `step` places after the open one in list order, wrapping around (US-1.8.2). */
    openNext(step: 1 | -1): void {
        const keys = hostGroups(this.store.getState()).flatMap((group) => group.sessions.map((item) => item.key));
        if (keys.length === 0) {
            return;
        }
        const current = keys.indexOf(this.store.getState().open ?? '');
        const next = current === -1 ? (step === 1 ? 0 : keys.length - 1) : (current + step + keys.length) % keys.length;
        const key = keys[next];
        if (key !== undefined) {
            this.open(key);
        }
    }

    /** Collapses or expands a host group. */
    toggle(hostId: string): void {
        this.#update((workspace) => hostToggled(workspace, hostId));
    }

    /** Creates a session on a connected host and opens it (US-1.7.1). */
    async newSession(hostId: string, options?: SessionOptions): Promise<void> {
        const host = this.#host(hostId);
        if (host === undefined || !isConnected(host)) {
            return;
        }
        await this.#attempt('create', host.id, async () => {
            const session = await this.#terminals.create(host.id, options);
            this.#update((workspace) => sessionChanged(workspace, host.id, { kind: 'created', session }));
            this.open(sessionKey(host.id, session.id));
        });
    }

    /** Creates a session with the options the New session dialog chose (US-1.7.2). */
    newSessionWith(hostId: string, options: SessionOptions): Promise<void> {
        return this.newSession(hostId, options);
    }

    /**
     * Creates a session on the open session's host, else the last-used host, else the first connected one, in the
     * home folder or, when set, the open session's folder (US-1.7.1).
     */
    newSessionHere(): Promise<void> {
        const host = this.defaultHost();
        if (host === undefined) {
            return Promise.resolve();
        }
        const cwd = this.#openFolder(host);
        return cwd === undefined ? this.newSession(host) : this.newSession(host, { cwd });
    }

    /** The host a new session goes to: the open session's, else the last-used, else the first connected one. */
    defaultHost(): string | undefined {
        const { open, hosts } = this.store.getState();
        const connected = (id: string | undefined): boolean =>
            hosts.some((host) => host.id === id && isConnected(host));
        const candidates = [open?.split('/')[0], this.#lastHost, hosts.find(isConnected)?.id];
        return candidates.find(connected);
    }

    /** The shell profiles a connected host offers (US-1.7.2). */
    async profiles(hostId: string): Promise<readonly ShellProfile[]> {
        const reply = await this.#client.request(hostId, { type: 'listProfiles' });
        return reply.type === 'profiles' ? reply.profiles : [];
    }

    /** Renames a session; an empty name gives the program's title back (US-1.10.1). */
    async renameSession(key: SessionKey, name: string): Promise<void> {
        const trimmed = name.trim();
        await this.#sessionRequest(key, 'rename', (session) => ({
            type: 'rename',
            session,
            ...(trimmed === '' ? {} : { name: trimmed }),
        }));
    }

    /** Stops a session: SIGHUP, then SIGTERM, then SIGKILL after the daemon's grace period (US-1.10.2). */
    stopSession(key: SessionKey): Promise<void> {
        const grace = this.#preferences?.().stopGraceSeconds;
        return this.#sessionRequest(key, 'stop', (session) => ({
            type: 'stop',
            session,
            ...(grace === undefined ? {} : { graceMs: grace * 1_000 }),
        }));
    }

    /** Restarts a session with its shell, directory and environment, keeping its scrollback (US-1.10.3). */
    restartSession(key: SessionKey): Promise<void> {
        return this.#sessionRequest(key, 'restart', (session) => ({ type: 'restart', session }));
    }

    /** Stops a session if it runs, then removes it and its scrollback (US-1.10.4). */
    closeSession(key: SessionKey): Promise<void> {
        return this.#sessionRequest(key, 'close', (session) => ({ type: 'close', session }));
    }

    /** Moves a session to `index` among its host's sessions (US-1.10.6). */
    moveSession(key: SessionKey, index: number): Promise<void> {
        return this.#sessionRequest(key, 'move', (session) => ({ type: 'reorder', session, index }));
    }

    /** Opens a new session on the same host with the same shell and working directory (US-1.10.5). */
    async duplicateSession(key: SessionKey): Promise<void> {
        const found = this.#find(key);
        if (found !== undefined) {
            const { profile, cwd } = found.session;
            await this.newSession(found.hostId, { profileId: profile.id, ...(cwd === undefined ? {} : { cwd }) });
        }
    }

    async #sessionRequest(
        key: SessionKey,
        action: FailedAction,
        request: (session: string) => ClientRequest,
    ): Promise<void> {
        const found = this.#find(key);
        if (found !== undefined) {
            await this.#attempt(action, found.hostId, () =>
                this.#client.request(found.hostId, request(found.session.id)),
            );
        }
    }

    /** Runs an action; a failure becomes the workspace's latest action failure instead of an unhandled rejection. */
    async #attempt(action: FailedAction, hostId: string, work: () => Promise<unknown>): Promise<void> {
        try {
            await work();
        } catch (error) {
            this.#failed(action, hostId, error);
        }
    }

    #failed(action: FailedAction, hostId: string, error?: unknown): void {
        const code = error instanceof HostRequestError ? error.code : 'unknown';
        this.#update((workspace) => ({
            ...workspace,
            actionFailure: { id: (workspace.actionFailure?.id ?? 0) + 1, action, hostId, code },
        }));
    }

    async #reattach(hostId: string): Promise<void> {
        const failed = await this.#terminals.reattachHost(hostId);
        if (failed.length > 0) {
            this.#failed('reattach', hostId);
        }
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
            if (this.#forgotten.has(hostId)) {
                return;
            }
            const notifyFailure = !this.#automatic.has(hostId);
            if (state.status !== 'connecting' && state.status !== 'host-key') {
                this.#automatic.delete(hostId);
            }
            this.#update((workspace) => hostStateChanged(workspace, hostId, state, { notifyFailure }));
            this.#finishTest(hostId, state);
            this.#followTerminals(hostId, state);
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

    #followTerminals(hostId: string, state: ConnectionState): void {
        switch (state.status) {
            case 'connected':
                void this.#reattach(hostId);
                void this.#listSessions(hostId);
                break;
            case 'disconnected':
            case 'failed':
                this.#terminals.setHostConnected(hostId, false);
                break;
            case 'closed':
                this.#terminals.closeHost(hostId);
                break;
            default:
                break;
        }
    }

    #finishTest(hostId: string, state: ConnectionState): void {
        const finish = this.#tests.get(hostId);
        if (finish === undefined || state.status === 'connecting' || state.status === 'host-key') {
            return;
        }
        this.#tests.delete(hostId);
        finish(state.status === 'connected');
        if (state.status === 'connected') {
            this.#client.disconnect(hostId);
        }
    }

    async #listSessions(hostId: string): Promise<void> {
        const reply = await this.#client.request(hostId, { type: 'listSessions' }).catch(() => undefined);
        if (reply?.type === 'sessions') {
            this.#update((workspace) => sessionsListed(workspace, hostId, reply.sessions));
            this.#closeIfClean(hostId, reply.sessions);
        }
    }

    #closeIfClean(hostId: string, sessions: readonly SessionInfo[]): void {
        if (this.#preferences?.().autoClose === false) {
            return;
        }
        for (const session of sessions.filter(exitedCleanly)) {
            this.#client.request(hostId, { type: 'close', session: session.id }).catch(() => undefined);
        }
    }

    #openFolder(hostId: string): string | undefined {
        const open = this.store.getState().open;
        if (this.#preferences?.().newSessionFolder !== 'open-session' || open === undefined) {
            return undefined;
        }
        const found = this.#find(open);
        return found?.hostId === hostId ? found.session.cwd : undefined;
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
