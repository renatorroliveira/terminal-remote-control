import { createIntl } from 'react-intl';
import { describe, expect, it } from 'vitest';
import { NotificationCenter } from './notifications';
import { QuitFlow, type QuitWorkspace } from './quit-flow';

function flow(running: ReturnType<QuitWorkspace['runningSessions']>, failed: readonly string[] = []) {
    const calls: string[] = [];
    const spoken: string[] = [];
    const notifications = new NotificationCenter();
    const quit = new QuitFlow({
        workspace: {
            runningSessions: () => running,
            stopAll: async () => {
                calls.push('stop all');
                return failed;
            },
        },
        controls: {
            quit: async () => void calls.push('quit'),
            quitNoticeOpened: async () => void calls.push('notice'),
        },
        announcer: { announce: (text) => spoken.push(text) },
        notifications,
        intl: createIntl({ locale: 'en' }),
    });
    return { calls, spoken, notifications, quit };
}

const running = { sessions: 3, hosts: 2, unreachable: [] };

describe('QuitFlow: the first quit (US-2.1.5, P-26)', () => {
    it('quits at once when no session runs, without showing the notice', () => {
        const { calls, quit } = flow({ sessions: 0, hosts: 0, unreachable: [] });
        quit.quitRequested();
        expect(calls).toEqual(['quit']);
        expect(quit.state.getState().dialog).toBeUndefined();
    });

    it('shows the notice once while sessions run, and quits, stops them first, or cancels', () => {
        const { calls, quit } = flow(running);
        quit.quitRequested();
        expect(quit.state.getState().dialog).toEqual({ kind: 'first-quit' });
        expect(calls).toEqual(['notice']);
        quit.cancel();
        expect(quit.state.getState().dialog).toBeUndefined();
        quit.quitRequested();
        quit.requestStopAll();
        expect(quit.state.getState().dialog).toEqual({ kind: 'stop-all', running });
        quit.quit();
        expect(calls).toEqual(['notice', 'notice', 'quit']);
    });
});

describe('QuitFlow: Quit and Stop All Sessions (US-2.1.4)', () => {
    it('asks first, then stops every running session and quits', async () => {
        const { calls, quit } = flow({ sessions: 2, hosts: 1, unreachable: ['devbox-2'] });
        quit.requestStopAll();
        expect(quit.state.getState().dialog).toEqual({
            kind: 'stop-all',
            running: { sessions: 2, hosts: 1, unreachable: ['devbox-2'] },
        });
        await quit.confirmStopAll();
        expect(calls).toEqual(['stop all', 'quit']);
    });

    it('quits at once when nothing runs on a connected host', async () => {
        const { calls, quit } = flow({ sessions: 0, hosts: 0, unreachable: [] });
        quit.requestStopAll();
        expect(calls).toEqual(['quit']);
    });

    it('stays open and says which host refused, so the user can try again (WCAG 3.3.1)', async () => {
        const { calls, quit, spoken, notifications } = flow(running, ['devbox-1']);
        quit.requestStopAll();
        await quit.confirmStopAll();
        expect(calls).toEqual(['stop all']);
        expect(quit.state.getState().dialog).toBeUndefined();
        const text = 'Couldn’t stop the sessions on devbox-1. TRC is still open.';
        expect(spoken).toEqual([text]);
        expect(notifications.store.getState().items.map((item) => item.text)).toEqual([text]);
    });
});
