import type { SessionInfo } from '@trc/protocol';
import { type HostEntry, isConnected, type SessionKey, type Workspace } from './workspace-model';

/** The open session, once it ended, with its record as the workspace keeps it. */
export interface EndedSession {
    readonly key: SessionKey;
    readonly session: SessionInfo;
}

/**
 * The open session when it exited, was stopped or failed to start while its host is connected, which the terminal's
 * banner then names with Restart and Remove (US-1.10.9); `undefined` while it runs, starts or cannot be reached.
 */
export function endedSession(workspace: Workspace): EndedSession | undefined {
    const open = openSession(workspace);
    if (open?.host === undefined || !isConnected(open.host) || !ENDED.has(open.session.state)) {
        return undefined;
    }
    return { key: open.key, session: open.session };
}

/**
 * Whether the open session ended between `before` and `after`: it was starting or running, and has now ended on its
 * connected host. A session that had ended before its host reconnected, or before the app started, did not just end.
 */
export function justEnded(before: Workspace, after: Workspace): boolean {
    const ended = endedSession(after);
    if (ended === undefined || before.open !== after.open) {
        return false;
    }
    const previous = openSession(before)?.session.state;
    return previous !== undefined && LIVE.has(previous);
}

const ENDED: ReadonlySet<SessionInfo['state']> = new Set(['exited', 'stopped', 'failedToStart']);
const LIVE: ReadonlySet<SessionInfo['state']> = new Set(['starting', 'running']);

/** The open session's key, host and record, whatever its host's connection. */
function openSession(
    workspace: Workspace,
): { readonly key: SessionKey; readonly host: HostEntry | undefined; readonly session: SessionInfo } | undefined {
    const key = workspace.open;
    const separator = key?.indexOf('/') ?? -1;
    if (key === undefined || separator < 0) {
        return undefined;
    }
    const hostId = key.slice(0, separator);
    const session = workspace.sessions.get(hostId)?.find((entry) => entry.id === key.slice(separator + 1));
    if (session === undefined) {
        return undefined;
    }
    return { key, host: workspace.hosts.find((entry) => entry.id === hostId), session };
}
