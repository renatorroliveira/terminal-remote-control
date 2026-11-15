import type { SessionInfo } from '@trc/protocol';
import type { StoreApi } from 'zustand/vanilla';
import { CACHE_LIMITS, type CachedSession, type SessionCache } from '../../shared/session-cache';
import type { Workspace } from './workspace-model';

/** Where the session cache is kept: the main process's `sessions.json` (P-30). */
export interface SessionCacheStore {
    load(): Promise<SessionCache>;
    save(cache: SessionCache): Promise<void>;
}

/** How long the session list must stay the same before it is saved, so a burst of updates is one write. */
const SAVE_DELAY_MS = 500;
/** A save that failed is tried again this much later, at most this many times, until the list changes. */
const RETRY_DELAY_MS = 5_000;
const RETRIES = 2;

/**
 * What the session list shows of each host's sessions, as the cache keeps it (P-30): within what `sessions.json`
 * takes, so one long title or a crowded host never stops the cache from saving.
 */
export function cachedSessions(workspace: Workspace): SessionCache {
    const hosts: Record<string, readonly CachedSession[]> = {};
    let room: number = CACHE_LIMITS.sessions;
    for (const [hostId, sessions] of [...workspace.sessions].slice(0, CACHE_LIMITS.hosts)) {
        const kept = sessions.slice(0, Math.min(CACHE_LIMITS.sessionsPerHost, room));
        if (kept.length > 0) {
            hosts[hostId] = kept.map(cachedSession);
            room -= kept.length;
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
 * Saves what the session list shows whenever it changes and then holds still for half a second, trying a failed save
 * twice more 5 s apart; `saved` is what the cache already holds. Returns a function that stops watching.
 */
export function watchSessionCache(
    store: StoreApi<Workspace>,
    cache: Pick<SessionCacheStore, 'save'>,
    saved: SessionCache,
): () => void {
    let last: string | undefined = JSON.stringify(saved);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retries = 0;
    let stopped = false;
    const failed = (): void => {
        last = undefined;
        if (!stopped && retries < RETRIES) {
            retries += 1;
            clearTimeout(timer);
            timer = setTimeout(save, RETRY_DELAY_MS);
        }
    };
    const save = (): void => {
        timer = undefined;
        const next = cachedSessions(store.getState());
        const text = JSON.stringify(next);
        if (text !== last) {
            last = text;
            cache.save(next).catch(failed);
        }
    };
    const stop = store.subscribe((state, previous) => {
        if (state.sessions !== previous.sessions) {
            clearTimeout(timer);
            retries = 0;
            timer = setTimeout(save, SAVE_DELAY_MS);
        }
    });
    return () => {
        stopped = true;
        stop();
        clearTimeout(timer);
    };
}

function cachedSession(session: SessionInfo): CachedSession {
    return {
        id: session.id,
        ...(session.customName === undefined ? {} : { name: clipped(session.customName) }),
        ...(session.title === undefined ? {} : { title: clipped(session.title) }),
        shell: clipped(session.profile.name),
        order: session.order,
        state: session.state,
    };
}

/** Cuts text to what the cache takes, never inside a surrogate pair. */
function clipped(text: string): string {
    if (text.length <= CACHE_LIMITS.text) {
        return text;
    }
    const end = isHighSurrogate(text.charCodeAt(CACHE_LIMITS.text - 1)) ? CACHE_LIMITS.text - 1 : CACHE_LIMITS.text;
    return text.slice(0, end);
}

function isHighSurrogate(code: number): boolean {
    return code >= 0xd8_00 && code <= 0xdb_ff;
}
