import type { SessionInfo } from '@trc/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import type { SessionCache } from '../../shared/session-cache';
import { cachedSessions, restoredSession, watchSessionCache } from './session-cache';
import { EMPTY_WORKSPACE, sessionName, sessionsListed, type Workspace } from './workspace-model';
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
