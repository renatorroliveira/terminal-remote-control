import type { SessionInfo, SessionState } from '@trc/protocol';
import { describe, expect, it } from 'vitest';
import { endedSession } from './ended-session';
import {
    EMPTY_WORKSPACE,
    hostAdded,
    hostStateChanged,
    sessionOpened,
    sessionsListed,
    type Workspace,
} from './workspace-model';

const connected = { status: 'connected', daemon: { version: '0.5.0', sha256: 'ab', proto: 3 } } as const;

function session(state: SessionState): SessionInfo {
    return {
        id: 'a',
        order: 0,
        state,
        profile: {
            id: 'login',
            name: 'zsh',
            origin: 'login',
            kind: 'zsh',
            path: '/bin/zsh',
            args: [],
            login: true,
            env: {},
            integration: 'off',
        },
        size: { cols: 80, rows: 24 },
    };
}

function opened(state: SessionState, connection: Workspace['hosts'][number]['state'] = connected): Workspace {
    const host = { id: 'host-a', address: { destination: 'devbox-1' }, installRoot: '~/.trc' };
    const workspace = hostStateChanged(hostAdded(EMPTY_WORKSPACE, host), 'host-a', connection);
    return sessionOpened(sessionsListed(workspace, 'host-a', [session(state)]), 'host-a/a');
}

describe('endedSession (US-1.10.9)', () => {
    it('is the open session once it exited, stopped or failed to start, while its host is connected', () => {
        for (const state of ['exited', 'stopped', 'failedToStart'] as const) {
            const workspace = opened(state);
            expect(endedSession(workspace)).toEqual({
                key: 'host-a/a',
                session: workspace.sessions.get('host-a')?.[0],
            });
        }
    });

    it('is none while the open session runs or starts, its host is not connected, or no session is open', () => {
        expect(endedSession(opened('running'))).toBeUndefined();
        expect(endedSession(opened('starting'))).toBeUndefined();
        expect(endedSession(opened('exited', { status: 'idle' }))).toBeUndefined();
        expect(endedSession(sessionOpened(opened('exited'), undefined))).toBeUndefined();
    });
});
