import type { ErrorCode, SessionChange, SessionId, SessionInfo } from '@trc/protocol';
import type { ConnectionState } from '../../shared/connection';
import { formatHostAddress } from '../../shared/host-address';
import type { KnownHost } from '../../shared/hosts';
import { stripControlCharacters } from '../../shared/text';
import { sessionPlace } from './session-place';

/** A known host and its connection state. */
export interface HostEntry extends KnownHost {
    /** The address as the user typed it, which names the host in the UI. */
    readonly destination: string;
    readonly state: ConnectionState;
    /** Whether it is reconnecting by itself: waiting for its next attempt or making one (US-2.2.2). */
    readonly reconnecting: boolean;
    /** The home folder its daemon last reported, which session names shorten to `~` (P-48). */
    readonly home?: string;
    /** What the user asked its daemon to do that is still under way (US-3.3.2, US-3.3.3). */
    readonly daemonAction?: DaemonAction;
}

/** A daemon change under way: a restart until the host connects again, or a removal until it ends. */
export type DaemonAction = 'restarting' | 'removing';

/** Identifies a session across hosts. */
export type SessionKey = string;

/** The renderer's read model of hosts and sessions (TECH_STACK §4.4). */
export interface Workspace {
    /** Hosts in the order they were added. */
    readonly hosts: readonly HostEntry[];
    /** Each host's sessions, in the daemon's order. */
    readonly sessions: ReadonlyMap<string, readonly SessionInfo[]>;
    /** The session shown in the terminal area. */
    readonly open: SessionKey | undefined;
    /** Host groups the user collapsed. */
    readonly collapsed: ReadonlySet<string>;
    /** The host whose failed connection waits for the user to acknowledge it (US-1.3.3). */
    readonly failureNotice: string | undefined;
    /** Sessions with output the user has not seen since they last had them open (US-1.8.3). */
    readonly unread: ReadonlySet<SessionKey>;
    /** Background sessions whose bell rang since they were last open (A11Y-08.2). */
    readonly bells: ReadonlySet<SessionKey>;
    /** For each session, the restore it was last opened after, so its Restored badge clears (US-3.1.6, P-42). */
    readonly restoreSeen: ReadonlyMap<SessionKey, number>;
    /** The last session or host action that failed, for the shell to show and announce (WCAG 3.3.1). */
    readonly actionFailure: ActionFailure | undefined;
}

/** The actions whose failure the shell reports. */
export type FailedAction =
    | 'create'
    | 'open'
    | 'rename'
    | 'stop'
    | 'restart'
    | 'close'
    | 'move'
    | 'forget'
    | 'clipboard'
    | 'reattach'
    | 'options'
    | 'clearScrollback'
    | 'restartDaemon';

/** An action the daemon, the connection or the app refused (US-1.10, US-1.14.3). */
export interface ActionFailure {
    /** Goes up with each failure, so the same failure twice is reported twice. */
    readonly id: number;
    readonly action: FailedAction;
    readonly hostId: string;
    readonly code: ActionFailureCode;
}

/** Why an action failed: the daemon's error code, `disconnected`, or `unknown` when nothing says why. */
export type ActionFailureCode = ErrorCode | 'disconnected' | 'unknown';

/** One session in a host's list. */
export interface SessionItem {
    readonly key: SessionKey;
    readonly label: string;
    /** Where it is: the last two folders of its working directory, shown before its name (P-48). */
    readonly place: string | undefined;
    readonly session: SessionInfo;
    /** Whether it has output the user has not seen (US-1.8.3). */
    readonly unread: boolean;
    /** Whether its bell rang while it was in the background (A11Y-08.2). */
    readonly bell: boolean;
    /** Whether it was restored after its processes ended and has not been opened since (US-3.1.6, P-42). */
    readonly restored: boolean;
    /** Whether its host is not connected, so it takes no input (US-1.14.1). */
    readonly disconnected: boolean;
    /** Whether its host is reconnecting by itself (US-2.2.2). */
    readonly reconnecting: boolean;
}

/** A host in the Sessions area, with its sessions; the sidebar hides them while the host is collapsed. */
export interface HostGroup {
    readonly host: HostEntry;
    readonly expanded: boolean;
    readonly sessions: readonly SessionItem[];
}

/** How a connection state change is reported. */
export interface StateChangeOptions {
    /** Whether a failure waits for the user to acknowledge it; not for connections the app started on its own. */
    readonly notifyFailure: boolean;
}

/** A workspace with no hosts. */
export const EMPTY_WORKSPACE: Workspace = {
    hosts: [],
    sessions: new Map(),
    open: undefined,
    collapsed: new Set(),
    failureNotice: undefined,
    unread: new Set(),
    bells: new Set(),
    restoreSeen: new Map(),
    actionFailure: undefined,
};

/** The key of a host's session. */
export function sessionKey(hostId: string, sessionId: SessionId): SessionKey {
    return `${hostId}/${sessionId}`;
}

/** A session's display name: the user's name, then the program's title, then the shell's name (US-1.10). */
export function sessionName(session: SessionInfo): string {
    return stripControlCharacters(session.customName ?? session.title ?? session.profile.name);
}

/**
 * Adds a known host, not connected yet, named by its address, or This computer by `localName`; adding a host already
 * there keeps it.
 */
export function hostAdded(workspace: Workspace, host: KnownHost, localName = 'This computer'): Workspace {
    if (workspace.hosts.some((entry) => entry.id === host.id)) {
        return workspace;
    }
    const entry: HostEntry = {
        ...host,
        destination: host.local === true ? localName : formatHostAddress(host.address),
        state: { status: 'idle' },
        reconnecting: false,
    };
    return { ...workspace, hosts: [...workspace.hosts, entry] };
}

/**
 * Records a host's new connection state. A failure waits for the user to acknowledge it, unless the user caused it
 * by rejecting the host key or the app started the connection on its own; a closed connection takes its sessions
 * out of the sidebar. A host stays reconnecting from its `reconnecting` state through the attempts that follow, until
 * it connects or stops (US-2.2.2).
 */
export function hostStateChanged(
    workspace: Workspace,
    hostId: string,
    state: ConnectionState,
    options: StateChangeOptions = { notifyFailure: true },
): Workspace {
    const hosts = workspace.hosts.map((host) =>
        host.id === hostId
            ? withoutRestart({ ...host, ...homeOf(state), state, reconnecting: stillReconnecting(host, state) })
            : host,
    );
    if (state.status === 'failed' && options.notifyFailure && state.failure.kind !== 'host-key-rejected') {
        return { ...workspace, hosts, failureNotice: hostId };
    }
    if (state.status !== 'closed') {
        return { ...workspace, hosts };
    }
    const sessions = new Map(workspace.sessions);
    sessions.delete(hostId);
    const open = workspace.open?.startsWith(`${hostId}/`) === true ? undefined : workspace.open;
    return { ...workspace, hosts, sessions, open };
}

/** Records what the user asked a host's daemon to do, or that it is done (US-3.3.2, US-3.3.3). */
export function daemonActionChanged(workspace: Workspace, hostId: string, action: DaemonAction | undefined): Workspace {
    return {
        ...workspace,
        hosts: workspace.hosts.map((host) => {
            if (host.id !== hostId) {
                return host;
            }
            const { daemonAction: _previous, ...rest } = host;
            return action === undefined ? rest : { ...rest, daemonAction: action };
        }),
    };
}

/** Shows a host's sessions as cached at the last run, Reconnecting until the host lists its own (US-2.3.2). */
export function hostRestored(workspace: Workspace, hostId: string, sessions: readonly SessionInfo[]): Workspace {
    const hosts = workspace.hosts.map((host) => (host.id === hostId ? { ...host, reconnecting: true } : host));
    return sessionsListed({ ...workspace, hosts }, hostId, sessions);
}

/** Drops a host the user forgot, with its sessions; nothing of it stays open or collapsed (A11Y-11.9). */
export function hostRemoved(workspace: Workspace, hostId: string): Workspace {
    const sessions = new Map(workspace.sessions);
    sessions.delete(hostId);
    const collapsed = new Set(workspace.collapsed);
    collapsed.delete(hostId);
    return {
        ...workspace,
        hosts: workspace.hosts.filter((host) => host.id !== hostId),
        sessions,
        collapsed,
        open: workspace.open?.startsWith(`${hostId}/`) === true ? undefined : workspace.open,
        failureNotice: workspace.failureNotice === hostId ? undefined : workspace.failureNotice,
    };
}

/**
 * Takes a host's changed record: its install location (US-1.4.3), its clipboard permission (SEC-06.1) or whether its
 * daemon was removed (P-45).
 */
export function hostUpdated(workspace: Workspace, known: KnownHost): Workspace {
    return {
        ...workspace,
        hosts: workspace.hosts.map((host) =>
            host.id === known.id
                ? {
                      ...known,
                      destination: host.destination,
                      state: host.state,
                      reconnecting: host.reconnecting,
                      ...(host.home === undefined ? {} : { home: host.home }),
                      ...(host.daemonAction === undefined ? {} : { daemonAction: host.daemonAction }),
                  }
                : host,
        ),
    };
}

/** The user has read the failure notice. */
export function failureAcknowledged(workspace: Workspace): Workspace {
    return { ...workspace, failureNotice: undefined };
}

/** Whether a host has a working connection. */
export function isConnected(host: HostEntry): boolean {
    return host.state.status === 'connected';
}

/** Replaces a host's sessions with the daemon's list. */
export function sessionsListed(workspace: Workspace, hostId: string, sessions: readonly SessionInfo[]): Workspace {
    return withSessions(workspace, hostId, sortByOrder(sessions));
}

/** Applies one daemon session event to a host's sessions; a closed session is no longer open. */
export function sessionChanged(workspace: Workspace, hostId: string, change: SessionChange): Workspace {
    const next = withSessions(workspace, hostId, applySessionChange(workspace.sessions.get(hostId) ?? [], change));
    const closedOpen = change.kind === 'closed' && workspace.open === sessionKey(hostId, change.sessionId);
    return closedOpen ? { ...next, open: undefined } : next;
}

/** Applies one daemon session event to a session list. */
export function applySessionChange(sessions: readonly SessionInfo[], change: SessionChange): readonly SessionInfo[] {
    switch (change.kind) {
        case 'created':
        case 'updated':
            return sortByOrder([...sessions.filter((entry) => entry.id !== change.session.id), change.session]);
        case 'closed':
            return sessions.filter((entry) => entry.id !== change.sessionId);
        case 'reordered':
            return reorder(sessions, change.order);
    }
}

/** Opens a session in the terminal area; its output, and its restore, count as seen. */
export function sessionOpened(workspace: Workspace, key: SessionKey | undefined): Workspace {
    if (key === undefined || (!workspace.unread.has(key) && !workspace.bells.has(key))) {
        return seeOpenRestore({ ...workspace, open: key });
    }
    const unread = new Set(workspace.unread);
    const bells = new Set(workspace.bells);
    unread.delete(key);
    bells.delete(key);
    return seeOpenRestore({ ...workspace, open: key, unread, bells });
}

/** Takes the restores already seen, as the session cache kept them at the last run (P-42). */
export function restoresSeen(workspace: Workspace, seen: ReadonlyMap<SessionKey, number>): Workspace {
    return { ...workspace, restoreSeen: new Map([...workspace.restoreSeen, ...seen]) };
}

/** Records a session's bell; unless it is open, its row shows a bell badge (A11Y-08.2). */
export function sessionBell(workspace: Workspace, key: SessionKey): Workspace {
    if (key === workspace.open || workspace.bells.has(key)) {
        return workspace;
    }
    return { ...workspace, bells: new Set([...workspace.bells, key]) };
}

/** Records output in a session; unless it is open, it now has unread output (US-1.8.3). */
export function sessionActivity(workspace: Workspace, key: SessionKey): Workspace {
    if (key === workspace.open || workspace.unread.has(key)) {
        return workspace;
    }
    return { ...workspace, unread: new Set([...workspace.unread, key]) };
}

/** Collapses or expands a host group (US-1.6.2). */
export function hostToggled(workspace: Workspace, hostId: string): Workspace {
    const collapsed = new Set(workspace.collapsed);
    if (!collapsed.delete(hostId)) {
        collapsed.add(hostId);
    }
    return { ...workspace, collapsed };
}

/** The hosts the Sessions area shows: each connected host or host with sessions, in the order added. */
export function hostGroups(workspace: Workspace): readonly HostGroup[] {
    return workspace.hosts
        .filter((host) => isConnected(host) || (workspace.sessions.get(host.id)?.length ?? 0) > 0)
        .map((host) => ({
            host,
            expanded: !workspace.collapsed.has(host.id),
            sessions: (workspace.sessions.get(host.id) ?? []).map((session) => ({
                key: sessionKey(host.id, session.id),
                unread: workspace.unread.has(sessionKey(host.id, session.id)),
                bell: workspace.bells.has(sessionKey(host.id, session.id)),
                restored:
                    session.restored !== undefined &&
                    workspace.restoreSeen.get(sessionKey(host.id, session.id)) !== session.restored.at,
                disconnected: !isConnected(host),
                reconnecting: host.reconnecting,
                label: sessionName(session),
                place: sessionPlace(session.cwd, host.home),
                session,
            })),
        }));
}

function homeOf(state: ConnectionState): { readonly home?: string } {
    const home = state.status === 'connected' ? state.daemon.details?.home : undefined;
    return home === undefined ? {} : { home };
}

function stillReconnecting(host: HostEntry, state: ConnectionState): boolean {
    switch (state.status) {
        case 'reconnecting':
            return true;
        case 'connecting':
        case 'host-key':
            return host.reconnecting;
        default:
            return false;
    }
}

function withSessions(workspace: Workspace, hostId: string, sessions: readonly SessionInfo[]): Workspace {
    const next = new Map(workspace.sessions);
    next.set(hostId, sessions);
    return seeOpenRestore({ ...workspace, sessions: next });
}

/** The open session's restore is seen at once: the user is looking at it. */
function seeOpenRestore(workspace: Workspace): Workspace {
    const key = workspace.open;
    const at = key === undefined ? undefined : sessionOf(workspace, key)?.restored?.at;
    if (key === undefined || at === undefined || workspace.restoreSeen.get(key) === at) {
        return workspace;
    }
    return { ...workspace, restoreSeen: new Map([...workspace.restoreSeen, [key, at]]) };
}

function sessionOf(workspace: Workspace, key: SessionKey): SessionInfo | undefined {
    const [hostId = '', id] = key.split('/');
    return workspace.sessions.get(hostId)?.find((session) => session.id === id);
}

function sortByOrder(sessions: readonly SessionInfo[]): readonly SessionInfo[] {
    return [...sessions].sort((left, right) => left.order - right.order);
}

function reorder(sessions: readonly SessionInfo[], order: readonly SessionId[]): readonly SessionInfo[] {
    const byId = new Map(sessions.map((entry) => [entry.id, entry]));
    const ordered = order.flatMap((id) => {
        const entry = byId.get(id);
        return entry === undefined ? [] : [entry];
    });
    return [...ordered, ...sessions.filter((entry) => !order.includes(entry.id))];
}

/** The states a host passes through while its daemon restarts, before it connects again. */
const RESTARTING: ReadonlySet<ConnectionState['status']> = new Set(['disconnected', 'reconnecting', 'connecting']);

/**
 * A host whose daemon restarts has finished once it connects again, or once its connection fails, closes or asks
 * about its key instead, which the shell then reports as it would any other (US-3.3.2).
 */
function withoutRestart(host: HostEntry): HostEntry {
    if (host.daemonAction !== 'restarting' || RESTARTING.has(host.state.status)) {
        return host;
    }
    const { daemonAction: _done, ...rest } = host;
    return rest;
}
