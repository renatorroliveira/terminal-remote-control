import type { SessionInfo } from '@trc/protocol';
import type { StoreApi } from 'zustand/vanilla';
import type { CachedSession, SessionCache } from '../../shared/session-cache';
import type { Workspace } from './workspace-model';

/** Where the session cache is kept: the main process's `sessions.json` (P-30). */
export interface SessionCacheStore {
    load(): Promise<SessionCache>;
    save(cache: SessionCache): Promise<void>;
}

/** How long the session list must stay the same before it is saved, so a burst of updates is one write. */
const SAVE_DELAY_MS = 500;

/** What the session list shows of each host's sessions, as the cache keeps it (P-30). */
export function cachedSessions(workspace: Workspace): SessionCache {
    const hosts: Record<string, readonly CachedSession[]> = {};
    for (const [hostId, sessions] of workspace.sessions) {
        if (sessions.length > 0) {
            hosts[hostId] = sessions.map(cachedSession);
        }
    }
    return hosts;
}

/** A cached session as the list shows it until its host lists it again (US-2.3.2). */
export function restoredSession(cached: CachedSession): SessionInfo {
    return {
        id: cached.id,
        order: cached.order,
        state: cached.state,
        ...(cached.name === undefined ? {} : { customName: cached.name }),
        ...(cached.title === undefined ? {} : { title: cached.title }),
        profile: {
            id: 'cached',
            name: cached.shell,
            origin: 'unspecified',
            kind: 'unspecified',
            path: '',
            args: [],
            login: true,
            env: {},
            integration: 'unspecified',
        },
        size: { cols: 80, rows: 24 },
    };
}

/**
 * Saves what the session list shows whenever it changes and then holds still for half a second; `saved` is what the
 * cache already holds. Returns a function that stops watching.
 */
export function watchSessionCache(
    store: StoreApi<Workspace>,
    cache: Pick<SessionCacheStore, 'save'>,
    saved: SessionCache,
): () => void {
    let last = JSON.stringify(saved);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = (): void => {
        timer = undefined;
        const next = cachedSessions(store.getState());
        const text = JSON.stringify(next);
        if (text !== last) {
            last = text;
            cache.save(next).catch(() => undefined);
        }
    };
    const stop = store.subscribe((state, previous) => {
        if (state.sessions !== previous.sessions) {
            clearTimeout(timer);
            timer = setTimeout(save, SAVE_DELAY_MS);
        }
    });
    return () => {
        stop();
        clearTimeout(timer);
    };
}

function cachedSession(session: SessionInfo): CachedSession {
    return {
        id: session.id,
        ...(session.customName === undefined ? {} : { name: session.customName }),
        ...(session.title === undefined ? {} : { title: session.title }),
        shell: session.profile.name,
        order: session.order,
        state: session.state,
    };
}
