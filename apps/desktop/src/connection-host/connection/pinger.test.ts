import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pinger } from './pinger';

describe('Pinger (NFR-07)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('pings every 5 s with reserved request ids while pongs come back', () => {
        const sent: number[] = [];
        const timeouts: number[] = [];
        const pinger = new Pinger(
            (id) => sent.push(id),
            () => timeouts.push(Date.now()),
        );
        pinger.start();
        vi.advanceTimersByTime(5_000);
        expect(sent).toEqual([0x8000_0000]);
        pinger.pong(0x8000_0000);
        vi.advanceTimersByTime(5_000);
        expect(sent).toEqual([0x8000_0000, 0x8000_0001]);
        expect(timeouts).toEqual([]);
        pinger.stop();
    });

    it('times out 15 s after an unanswered ping', () => {
        let timedOut = 0;
        const pinger = new Pinger(
            () => undefined,
            () => {
                timedOut += 1;
            },
        );
        pinger.start();
        vi.advanceTimersByTime(5_000 + 14_999);
        expect(timedOut).toBe(0);
        vi.advanceTimersByTime(1);
        expect(timedOut).toBe(1);
        vi.advanceTimersByTime(60_000);
        expect(timedOut).toBe(1);
    });

    it('ignores pongs it did not ask for', () => {
        let timedOut = false;
        const pinger = new Pinger(
            () => undefined,
            () => {
                timedOut = true;
            },
        );
        pinger.start();
        vi.advanceTimersByTime(5_000);
        pinger.pong(7);
        vi.advanceTimersByTime(15_000);
        expect(timedOut).toBe(true);
    });
});
