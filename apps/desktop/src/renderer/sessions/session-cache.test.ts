import type { SessionInfo } from '@trc/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { CACHE_LIMITS, type SessionCache } from '../../shared/session-cache';
import { cachedSessions, restoredSession, seenRestores, watchSessionCache } from './session-cache';
import {
    EMPTY_WORKSPACE,
    restoresSeen,
    sessionKey,
    sessionName,
    sessionsListed,
    type Workspace,
} from './workspace-model';
import { bashSession } from './workspace-test-doubles';

const HOST = 'host-0123456789abcdef';

function listed(sessions: readonly SessionInfo[]): Workspace {
    return sessionsListed(EMPTY_WORKSPACE, HOST, sessions);
}

describe('the session cache (US-2.3.2, P-30)', () => {
    it('keeps only what the list shows of each session, and shows the session again from it', () => {
        const titled: SessionInfo = { ...bashSession('a'), title: 'vim notes', cwd: '/home/me', pid: 7 };
        const named: SessionInfo = { ...bashSession('b'), order: 1, customName: 'logs', state: 'exited' };
        const cache = cachedSessions(listed([titled, named]));
        expect(cache).toEqual({
            [HOST]: [
                { id: 'a', title: 'vim notes', shell: 'bash', order: 0, state: 'running' },
                { id: 'b', name: 'logs', shell: 'bash', order: 1, state: 'exited' },
            ],
        });
        const restored = (cache[HOST] ?? []).map(restoredSession);
        expect(restored.map(sessionName)).toEqual(['vim notes', 'logs']);
        expect(restored.map((session) => [session.id, session.order, session.state])).toEqual([
            ['a', 0, 'running'],
            ['b', 1, 'exited'],
        ]);
        expect(cachedSessions(listed(restored))).toEqual(cache);
    });

    it('keeps no title its programs set for a session that saves nothing to disk (US-3.2.2)', () => {
        const unsaved: SessionInfo = {
            ...bashSession('a'),
            title: 'cat secrets.txt',
            options: { restore: true, saveScrollback: false },
        };
        expect(cachedSessions(listed([unsaved]))).toEqual({
            [HOST]: [{ id: 'a', shell: 'bash', order: 0, state: 'running' }],
        });
    });

    it('keeps no more than sessions.json takes: long titles clipped whole, and at most 1,000 sessions a host', () => {
        const title = `${'x'.repeat(CACHE_LIMITS.text - 1)}😀 and more`;
        const many = Array.from({ length: CACHE_LIMITS.sessionsPerHost + 1 }, (_, order) => ({
            ...bashSession(order.toString(16).padStart(16, '0')),
            order,
            title,
        }));
        const kept = cachedSessions(listed(many))[HOST] ?? [];
        expect(kept).toHaveLength(CACHE_LIMITS.sessionsPerHost);
        expect(kept[0]?.title).toBe('x'.repeat(CACHE_LIMITS.text - 1));
    });
});

describe('the session cache: restores already seen (P-42)', () => {
    it('keeps the restore each session was last opened after, and gives it back at the next launch', () => {
        const restored = { at: 5, afterHostRestart: false };
        let workspace = listed([
            { ...bashSession('a'), restored },
            { ...bashSession('b'), order: 1, restored },
        ]);
        workspace = restoresSeen(workspace, new Map([[sessionKey(HOST, 'a'), 5]]));
        const cache = cachedSessions(workspace);
        expect(cache[HOST]?.map((cached) => cached.restoreSeen)).toEqual([5, undefined]);
        expect(seenRestores(HOST, cache[HOST] ?? [])).toEqual(new Map([[sessionKey(HOST, 'a'), 5]]));
    });
});

describe('watchSessionCache', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('saves once the list settles, and not while it shows what was saved', () => {
        const saves: SessionCache[] = [];
        const store = createStore<Workspace>(() => listed([bashSession('a')]));
        const stop = watchSessionCache(
            store,
            { save: async (cache) => void saves.push(cache) },
            cachedSessions(store.getState()),
        );
        store.setState(listed([bashSession('a')]), true);
        vi.advanceTimersByTime(1_000);
        expect(saves).toEqual([]);
        store.setState(listed([bashSession('a'), { ...bashSession('b'), order: 1 }]), true);
        store.setState(listed([bashSession('a'), { ...bashSession('b'), order: 1, title: 'top' }]), true);
        vi.advanceTimersByTime(1_000);
        expect(saves).toHaveLength(1);
        expect(saves[0]?.[HOST]?.map((session) => session.id)).toEqual(['a', 'b']);
        stop();
        store.setState(EMPTY_WORKSPACE, true);
        vi.advanceTimersByTime(1_000);
        expect(saves).toHaveLength(1);
    });
});

describe('watchSessionCache: failed saves', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('saves the list again after a save failed', async () => {
        let attempts = 0;
        const store = createStore<Workspace>(() => EMPTY_WORKSPACE);
        watchSessionCache(
            store,
            {
                save: () => {
                    attempts += 1;
                    return Promise.reject(new Error('disk full'));
                },
            },
            {},
        );
        store.setState(listed([bashSession('a')]), true);
        await vi.advanceTimersByTimeAsync(1_000);
        store.setState(listed([bashSession('a')]), true);
        await vi.advanceTimersByTimeAsync(1_000);
        expect(attempts).toBe(2);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(attempts).toBe(4);
    });

    it('tries no failed save again once stopped, even one that fails after', async () => {
        let attempts = 0;
        const store = createStore<Workspace>(() => EMPTY_WORKSPACE);
        const stop = watchSessionCache(
            store,
            {
                save: () => {
                    attempts += 1;
                    return new Promise((_, fail) => setTimeout(() => fail(new Error('disk full')), 2_000));
                },
            },
            {},
        );
        store.setState(listed([bashSession('a')]), true);
        await vi.advanceTimersByTimeAsync(1_000);
        stop();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(attempts).toBe(1);
    });
});

describe('watchSessionCache: a save that fails while the list changes', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('saves a list that changed while a save failed on time, not after the retry delay', async () => {
        const saves: SessionCache[] = [];
        let fail = true;
        const store = createStore<Workspace>(() => EMPTY_WORKSPACE);
        watchSessionCache(
            store,
            {
                save: (cache) => {
                    saves.push(cache);
                    const failing = fail;
                    fail = false;
                    return new Promise((done, failed) =>
                        setTimeout(() => (failing ? failed(new Error('disk full')) : done()), 1_000),
                    );
                },
            },
            {},
        );
        store.setState(listed([bashSession('a')]), true);
        await vi.advanceTimersByTimeAsync(1_400);
        store.setState(listed([bashSession('a'), { ...bashSession('b'), order: 1 }]), true);
        await vi.advanceTimersByTimeAsync(1_000);
        expect(saves.map((cache) => cache[HOST]?.length)).toEqual([1, 2]);
    });
});
