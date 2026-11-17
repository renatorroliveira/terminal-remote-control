import type { SessionInfo } from '@trc/protocol';
import { createIntl } from 'react-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import { messagesFor } from '../i18n/locale';
import {
    EMPTY_WORKSPACE,
    hostAdded,
    restoresSeen,
    sessionKey,
    sessionOpened,
    sessionsListed,
    type Workspace,
} from '../sessions/workspace-model';
import { bashSession } from '../sessions/workspace-test-doubles';
import type { NewNotification } from './notifications';
import { RESTORE_SETTLE_MS, reportPersistenceFailures, reportRestores } from './session-reporter';

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

const settle = () => vi.advanceTimersByTime(RESTORE_SETTLE_MS);

const HOST = 'host-0';

function harness() {
    const store = createStore<Workspace>(() =>
        hostAdded(EMPTY_WORKSPACE, { id: HOST, address: { destination: 'devbox-1' }, installRoot: '~/.trc' }),
    );
    const said: { text: string; politeness: string | undefined }[] = [];
    const listed: NewNotification[] = [];
    const options = {
        store,
        intl: createIntl({ locale: 'en', messages: messagesFor('en') }),
        announcer: {
            announce: (text: string, extra?: { readonly politeness?: 'polite' | 'assertive' }) =>
                said.push({ text, politeness: extra?.politeness }),
        },
        notifications: { add: (notification: NewNotification) => listed.push(notification) },
        playCue: () => undefined,
    };
    const list = (sessions: readonly SessionInfo[]) =>
        store.setState((workspace) => sessionsListed(workspace, HOST, sessions));
    return { store, said, listed, options, list };
}

const restored = (id: string, at: number, afterHostRestart: boolean): SessionInfo => ({
    ...bashSession(id),
    restored: { at, afterHostRestart },
});

describe('reportRestores: one announcement per host and restore (US-3.1.6, P-42)', () => {
    it('says how many sessions came back and whether the host restarted, once, politely, and lists it', () => {
        const { said, listed, options, list } = harness();
        const stop = reportRestores(options);
        list([restored('a', 5, true), restored('b', 5, true), restored('c', 5, true), bashSession('d')]);
        settle();
        list([restored('a', 5, true), restored('b', 5, true), restored('c', 5, true), bashSession('d')]);
        settle();
        expect(said).toEqual([{ text: 'devbox-1 restarted: 3 sessions restored.', politeness: undefined }]);
        expect(listed).toEqual([{ text: 'devbox-1 restarted: 3 sessions restored.', level: 'info' }]);
        stop();
    });

    it('says a session came back without a host restart, and stays quiet for one already opened', () => {
        const { said, options, list, store } = harness();
        store.setState((workspace) => restoresSeen(workspace, new Map([[sessionKey(HOST, 'b'), 7]])));
        const stop = reportRestores(options);
        list([restored('a', 7, false), restored('b', 7, false)]);
        settle();
        expect(said.map((entry) => entry.text)).toEqual(['devbox-1: 1 session restored.']);
        list([restored('a', 9, false), restored('b', 7, false)]);
        settle();
        expect(said.map((entry) => entry.text)).toEqual([
            'devbox-1: 1 session restored.',
            'devbox-1: 1 session restored.',
        ]);
        stop();
    });
});

describe('reportRestores: the open session', () => {
    it('counts the session open when its restore arrives, and restores that arrive one by one, once', () => {
        const { said, options, list, store } = harness();
        list([bashSession('a'), { ...bashSession('b'), order: 1 }]);
        store.setState((workspace) => sessionOpened(workspace, sessionKey(HOST, 'b')));
        const stop = reportRestores(options);
        list([restored('a', 7, false), { ...bashSession('b'), order: 1 }]);
        list([restored('a', 7, false), { ...restored('b', 7, false), order: 1 }]);
        expect(said).toEqual([]);
        settle();
        expect(said.map((entry) => entry.text)).toEqual(['devbox-1: 2 sessions restored.']);
        stop();
    });
});

describe('reportPersistenceFailures: a session whose scrollback cannot be saved (US-3.1.2)', () => {
    it('announces and lists the failure once, and again only after it cleared and came back', () => {
        const { said, listed, options, list } = harness();
        const stop = reportPersistenceFailures(options);
        const failing = { ...bashSession('a'), customName: 'build', persistenceFailure: 'diskFull' } as const;
        list([failing]);
        list([{ ...failing, title: 'make' }]);
        const text = 'Scrollback of build on devbox-1 can’t be saved: the disk is full.';
        expect(said).toEqual([{ text, politeness: 'assertive' }]);
        expect(listed).toEqual([{ text, level: 'error' }]);
        list([{ ...bashSession('a'), customName: 'build' }]);
        list([failing]);
        expect(said).toHaveLength(2);
        stop();
    });
});
