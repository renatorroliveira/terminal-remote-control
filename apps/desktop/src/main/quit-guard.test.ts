import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuitGuard } from './quit-guard';

function event() {
    const prevented = { value: false };
    return { prevented, event: { preventDefault: () => (prevented.value = true) } };
}

function guard(options: { shown?: boolean; asked?: boolean } = {}) {
    const calls: string[] = [];
    const quitGuard = new QuitGuard({
        noticeShown: options.shown ?? false,
        markShown: () => calls.push('mark'),
        ask: () => {
            calls.push('ask');
            return options.asked ?? true;
        },
        quit: () => calls.push('quit'),
    });
    return { calls, quitGuard };
}

describe('QuitGuard (US-2.1.5, P-26)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('lets a quit go once the first-quit notice was shown', () => {
        const { calls, quitGuard } = guard({ shown: true });
        const { prevented, event: quit } = event();
        quitGuard.beforeQuit(quit);
        expect(prevented.value).toBe(false);
        expect(calls).toEqual([]);
    });

    it('holds the first quit and asks the page, which quits or shows the notice once', () => {
        const { calls, quitGuard } = guard();
        const first = event();
        quitGuard.beforeQuit(first.event);
        expect(first.prevented.value).toBe(true);
        quitGuard.noticeOpened();
        vi.advanceTimersByTime(60_000);
        expect(calls).toEqual(['ask', 'mark']);
        quitGuard.quit();
        expect(calls).toEqual(['ask', 'mark', 'quit']);
        const after = event();
        quitGuard.beforeQuit(after.event);
        expect(after.prevented.value).toBe(false);
    });

    it('does not ask again once the notice was shown and the user cancelled', () => {
        const { calls, quitGuard } = guard();
        quitGuard.beforeQuit(event().event);
        quitGuard.noticeOpened();
        const again = event();
        quitGuard.beforeQuit(again.event);
        expect(again.prevented.value).toBe(false);
        expect(calls).toEqual(['ask', 'mark']);
    });

    it('quits when no page can answer, or the page does not answer in time, so quitting never hangs', () => {
        const none = guard({ asked: false });
        none.quitGuard.beforeQuit(event().event);
        expect(none.calls).toEqual(['ask', 'quit']);
        const silent = guard();
        silent.quitGuard.beforeQuit(event().event);
        vi.advanceTimersByTime(3_000);
        expect(silent.calls).toEqual(['ask', 'quit']);
    });
});
