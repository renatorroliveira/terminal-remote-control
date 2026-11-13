import type { SessionChange, SessionId, SessionInfo } from '@trc/protocol';
import type { ConnectionState } from '../../shared/connection';
import { formatHostAddress } from '../../shared/host-address';
import type { KnownHost } from '../../shared/hosts';

/** A known host and its connection state. */
export interface HostEntry extends KnownHost {
    /** The address as the user typed it, which names the host in the UI. */
    readonly destination: string;
    readonly state: ConnectionState;
}

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
}

/** One session in a host's list. */
export interface SessionItem {
    readonly key: SessionKey;
    readonly label: string;
    readonly session: SessionInfo;
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
};

/** The key of a host's session. */
export function sessionKey(hostId: string, sessionId: SessionId): SessionKey {
    return `${hostId}/${sessionId}`;
}

/** A session's display name: the user's name, then the program's title, then the shell's name (US-1.10). */
export function sessionName(session: SessionInfo): string {
    return session.customName ?? session.title ?? session.profile.name;
}

/** Adds a known host, not connected yet; adding a host already there keeps it. */
export function hostAdded(workspace: Workspace, host: KnownHost): Workspace {
    if (workspace.hosts.some((entry) => entry.id === host.id)) {
        return workspace;
    }
    const entry: HostEntry = { ...host, destination: formatHostAddress(host.address), state: { status: 'idle' } };
    return { ...workspace, hosts: [...workspace.hosts, entry] };
}

/**
 * Records a host's new connection state. A failure waits for the user to acknowledge it, unless the user caused it
 * by rejecting the host key or the app started the connection on its own; a closed connection takes its sessions
 * out of the sidebar.
 */
export function hostStateChanged(
    workspace: Workspace,
    hostId: string,
    state: ConnectionState,
    options: StateChangeOptions = { notifyFailure: true },
): Workspace {
    const hosts = workspace.hosts.map((host) => (host.id === hostId ? { ...host, state } : host));
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

/** Takes a host's new install location (US-1.4.3). */
export function hostMoved(workspace: Workspace, hostId: string, installRoot: string): Workspace {
    return {
        ...workspace,
        hosts: workspace.hosts.map((host) => (host.id === hostId ? { ...host, installRoot } : host)),
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

/** Opens a session in the terminal area. */
export function sessionOpened(workspace: Workspace, key: SessionKey | undefined): Workspace {
    return { ...workspace, open: key };
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
                label: sessionName(session),
                session,
            })),
        }));
}

function withSessions(workspace: Workspace, hostId: string, sessions: readonly SessionInfo[]): Workspace {
    const next = new Map(workspace.sessions);
    next.set(hostId, sessions);
    return { ...workspace, sessions: next };
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
