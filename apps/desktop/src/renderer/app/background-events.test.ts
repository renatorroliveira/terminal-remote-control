import type { SessionActivity, SessionInfo } from '@trc/protocol';
import { createIntl } from 'react-intl';
import { describe, expect, it } from 'vitest';
import { createStore } from 'zustand/vanilla';
import type { SessionNotice } from '../../shared/contract';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import {
    commandFinishedUnseen,
    EMPTY_WORKSPACE,
    type SessionKey,
    sessionBell,
    sessionEndedUnseen,
    type Workspace,
} from '../sessions/workspace-model';
import { BackgroundEvents, type BackgroundSettings, BELL_MERGE_MS, NOTICE_INTERVAL_MS } from './background-events';

const intl = createIntl({ locale: 'en', defaultLocale: 'en', messages: {} });

function session(id: string, state: SessionInfo['state'], extra: Partial<SessionInfo> = {}): SessionInfo {
    return {
        id,
        order: 0,
        state,
        title: 'make -j8',
        profile: {
            id: 'bash',
            name: 'bash',
            origin: 'detected',
            kind: 'bash',
            path: '/bin/bash',
            args: [],
            login: false,
            env: {},
            integration: 'auto',
        },
        size: { cols: 80, rows: 24 },
        ...extra,
    };
}

const HOST = {
    id: 'h1',
    destination: 'devbox-1',
    address: { destination: 'devbox-1' },
    state: { status: 'connected' },
    reconnecting: false,
} as unknown as Workspace['hosts'][number];

function setUp(settings: Partial<BackgroundSettings> = {}) {
    const store = createStore<Workspace>(() => ({
        ...EMPTY_WORKSPACE,
        hosts: [HOST],
        sessions: new Map([['h1', [session('build', 'running', { customName: 'build' }), session('logs', 'running')]]]),
        open: 'h1/logs',
    }));
    let activity: ((key: SessionKey, activity: SessionActivity) => void) | undefined;
    const said: string[] = [];
    const listed: string[] = [];
    const posted: SessionNotice[] = [];
    let now = 0;
    const events = new BackgroundEvents({
        workspace: {
            store,
            recordBell: (key) => store.setState(sessionBell(store.getState(), key), true),
            recordEnded: (key) => store.setState(sessionEndedUnseen(store.getState(), key), true),
            recordFinished: (key) => store.setState(commandFinishedUnseen(store.getState(), key), true),
            onSessionActivity: (listener) => {
                activity = listener;
                return () => {
                    activity = undefined;
                };
            },
        },
        intl,
        announcer: { announce: (text, options) => said.push(`${options?.group}: ${text}`) },
        notifications: { add: (notification) => listed.push(notification.text) },
        settings: () => ({ ...DEFAULT_SETTINGS, ...settings }),
        os: {
            post: async (notice) => {
                posted.push(notice);
                return true;
            },
        },
        now: () => now,
    });
    const stop = events.start();
    return {
        events,
        store,
        said,
        listed,
        posted,
        stop,
        report: (key: SessionKey, value: SessionActivity) => activity?.(key, value),
        advance: (ms: number) => {
            now += ms;
        },
    };
}

function end(store: ReturnType<typeof setUp>['store'], code: number): void {
    const state = store.getState();
    const ended = session('build', 'exited', { customName: 'build', exit: { code } });
    store.setState({ sessions: new Map([['h1', [ended, ...(state.sessions.get('h1') ?? []).slice(1)]]]) });
}

describe('BackgroundEvents: events in sessions that are not open (US-5.3)', () => {
    it('announces a long command finishing, merged per session, and badges its row until it is viewed', () => {
        const { store, said, report } = setUp();
        report('h1/build', { type: 'commandFinished', exitCode: 1, durationMs: 12_000 });
        report('h1/build', { type: 'commandFinished', exitCode: 0, durationMs: 2_000 });
        report('h1/logs', { type: 'commandFinished', exitCode: 1, durationMs: 60_000 });
        expect(said).toEqual(['bg:h1/build: Session build on devbox-1: command finished, exit code 1.']);
        expect(store.getState().finished).toEqual(new Set(['h1/build']));
    });

    it('takes a bell once though the daemon and the terminal both report it, and not in the open session', () => {
        const { events, store, said, report, advance } = setUp();
        report('h1/build', { type: 'bell' });
        events.bell('h1/build');
        events.bell('h1/logs');
        advance(BELL_MERGE_MS);
        events.bell('h1/build');
        expect(said).toEqual([
            'bg:h1/build: Session build on devbox-1: bell.',
            'bg:h1/build: Session build on devbox-1: bell.',
        ]);
        expect(store.getState().bells).toEqual(new Set(['h1/build']));
    });

    it('announces a session that ended while not open, with its exit code, but not one the user stopped', () => {
        const { store, said } = setUp();
        end(store, 2);
        const stopped = session('logs', 'stopped');
        store.setState({ open: 'h1/build' });
        store.setState({
            sessions: new Map([['h1', [store.getState().sessions.get('h1')?.[0] as SessionInfo, stopped]]]),
        });
        expect(said).toEqual(['bg:h1/build: Session build on devbox-1: ended, exit code 2.']);
        expect(store.getState().ended).toEqual(new Set(['h1/build']));
    });

    it('posts an OS notification and lists it when asked, with the session’s own name and never its title', async () => {
        const { store, said, listed, posted, report } = setUp({
            announceBackgroundEnd: false,
            notifyBackgroundEnd: true,
        });
        end(store, 0);
        report('h1/build', { type: 'bell' });
        expect(said).toEqual(['bg:h1/build: Session build on devbox-1: bell.']);
        expect(listed).toEqual(['Session build on devbox-1: ended, exit code 0.']);
        expect(posted).toEqual([{ title: 'build on devbox-1', body: 'Ended, exit code 0.', key: 'h1/build' }]);
    });

    it('posts one OS notification of a kind a session every 10 s, lists them all, and none for a restore’s end', async () => {
        const { store, posted, listed, report, advance } = setUp({
            notifyBackgroundBell: true,
            notifyBackgroundEnd: true,
        });
        report('h1/build', { type: 'bell' });
        advance(BELL_MERGE_MS);
        report('h1/build', { type: 'bell' });
        advance(NOTICE_INTERVAL_MS);
        report('h1/build', { type: 'bell' });
        const restarted = session('build', 'exited', { customName: 'build', exit: { ended: 'hostRestart' } });
        store.setState({
            sessions: new Map([['h1', [restarted, ...(store.getState().sessions.get('h1') ?? []).slice(1)]]]),
        });
        expect(posted.map((notice) => notice.body)).toEqual(['Bell.', 'Bell.']);
        expect(listed).toHaveLength(3);
        expect(store.getState().ended).toEqual(new Set());
    });

    it('stops watching when stopped', () => {
        const { store, said, stop, report } = setUp();
        stop();
        report('h1/build', { type: 'commandFinished', exitCode: 1, durationMs: 60_000 });
        end(store, 1);
        expect(said).toEqual([]);
    });
});
