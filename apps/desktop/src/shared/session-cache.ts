import type { SessionId, SessionState } from '@trc/protocol';

/** A session as the app last listed it, kept so it shows at once at the next launch (US-2.3.2, P-30). */
export interface CachedSession {
    readonly id: SessionId;
    /** The name the user gave it. */
    readonly name?: string;
    /** The title its program set. */
    readonly title?: string;
    /** The name of its shell, which names it without either. */
    readonly shell: string;
    /** Its position in the host's order. */
    readonly order: number;
    readonly state: SessionState;
}

/** The most `sessions.json` takes: UTF-16 code units in a name, title or shell, and sessions per host and in all. */
export const CACHE_LIMITS = { text: 1024, sessionsPerHost: 1000, sessions: 10_000, hosts: 1000 } as const;

/** Each host's sessions as last listed, by host ID (P-30). */
export type SessionCache = Readonly<Record<string, readonly CachedSession[]>>;
