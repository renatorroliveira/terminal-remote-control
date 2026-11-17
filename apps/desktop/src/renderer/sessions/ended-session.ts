import type { SessionInfo } from '@trc/protocol';
import { isConnected, type SessionKey, type Workspace } from './workspace-model';

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
    const key = workspace.open;
    const separator = key?.indexOf('/') ?? -1;
    if (key === undefined || separator < 0) {
        return undefined;
    }
    const hostId = key.slice(0, separator);
    const host = workspace.hosts.find((entry) => entry.id === hostId);
    const session = workspace.sessions.get(hostId)?.find((entry) => entry.id === key.slice(separator + 1));
    if (host === undefined || !isConnected(host) || session === undefined || !ENDED.has(session.state)) {
        return undefined;
    }
    return { key, session };
}

const ENDED: ReadonlySet<SessionInfo['state']> = new Set(['exited', 'stopped', 'failedToStart']);
