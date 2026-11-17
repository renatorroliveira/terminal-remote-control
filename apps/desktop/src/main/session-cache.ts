import { join } from 'node:path';
import { z } from 'zod';
import { CACHE_LIMITS, type CachedSession, type SessionCache } from '../shared/session-cache';
import { JsonStore } from './json-store';

interface SessionsFile {
    readonly hosts: SessionCache;
}

const TEXT = z.string().max(CACHE_LIMITS.text);

const SESSION_SCHEMA: z.ZodType<CachedSession> = z.strictObject({
    id: z.string().regex(/^[0-9a-f]{16}$/),
    name: TEXT.exactOptional(),
    title: TEXT.exactOptional(),
    shell: TEXT,
    order: z.number().int().min(0).max(1_000_000),
    state: z.enum(['starting', 'running', 'exited', 'stopped', 'failedToStart', 'unspecified']),
    restoreSeen: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).exactOptional(),
});

/** What `sessions.json` may hold: for each known host, what its session list showed (P-30, SEC-05.1). */
export const SESSION_CACHE_SCHEMA: z.ZodType<SessionCache> = z
    .record(z.string().regex(/^host-[0-9a-f]{16}$/), z.array(SESSION_SCHEMA).max(CACHE_LIMITS.sessionsPerHost))
    .refine((hosts) => Object.keys(hosts).length <= CACHE_LIMITS.hosts, 'too many hosts')
    .refine((hosts) => sessionCount(hosts) <= CACHE_LIMITS.sessions, 'too many sessions');

const FILE_SCHEMA: z.ZodType<SessionsFile> = z.strictObject({ hosts: SESSION_CACHE_SCHEMA });

/**
 * Each host's sessions as the app last listed them, kept in the TRC home's `sessions.json` (0600, written
 * atomically, read with zod) so they show at once at the next launch (US-2.3.2, P-30). The daemon stays the truth:
 * a host's own list replaces its cached one as soon as it connects.
 */
export class SessionCacheFile {
    readonly #store: JsonStore<SessionsFile>;
    #last: Promise<unknown> = Promise.resolve();

    /** The cache kept in `home`. */
    constructor(home: string) {
        this.#store = new JsonStore(join(home, 'sessions.json'), FILE_SCHEMA, { hosts: {} });
    }

    /** Every host's cached sessions; none when the file is missing or invalid. */
    async read(): Promise<SessionCache> {
        return (await this.#store.read()).hosts;
    }

    /** Replaces the cache, after any write still in progress. */
    write(hosts: SessionCache): Promise<void> {
        const next = this.#last.then(() => this.#store.write({ hosts }));
        this.#last = next.catch(() => undefined);
        return next;
    }
}

function sessionCount(hosts: SessionCache): number {
    return Object.values(hosts).reduce((count, sessions) => count + sessions.length, 0);
}
