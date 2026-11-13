import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdateScheduler } from './update-scheduler';

describe('UpdateScheduler (S3a cadence, R2)', () => {
    beforeEach(() => {
        vi.useFakeTimers({
            toFake: [
                'setTimeout',
                'clearTimeout',
                'requestAnimationFrame',
                'cancelAnimationFrame',
                'performance',
                'Date',
            ],
        });
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('updates once per animation frame without assistive technology', () => {
        let updates = 0;
        const scheduler = new UpdateScheduler(
            () => {
                updates += 1;
            },
            () => false,
        );
        scheduler.request();
        scheduler.request();
        vi.advanceTimersToNextFrame();
        expect(updates).toBe(1);
    });

    it('updates at most 4 times a second with assistive technology', () => {
        let updates = 0;
        const scheduler = new UpdateScheduler(
            () => {
                updates += 1;
            },
            () => true,
        );
        for (let tick = 0; tick < 99; tick += 1) {
            scheduler.request();
            vi.advanceTimersByTime(10);
        }
        expect(updates).toBeLessThanOrEqual(4);
        expect(updates).toBeGreaterThanOrEqual(3);
    });

    it('holds still while a flood lasts with assistive technology, then catches up', () => {
        let updates = 0;
        const scheduler = new UpdateScheduler(
            () => {
                updates += 1;
            },
            () => true,
        );
        for (let tick = 0; tick < 20; tick += 1) {
            scheduler.output(80 * 1024);
            scheduler.request();
            vi.advanceTimersByTime(100);
        }
        expect(updates).toBe(0);
        vi.advanceTimersByTime(1_000);
        expect(updates).toBe(1);
    });
});

describe('UpdateScheduler: typing echo (NFR-02, A11Y-06)', () => {
    beforeEach(() => {
        vi.useFakeTimers({
            toFake: [
                'setTimeout',
                'clearTimeout',
                'requestAnimationFrame',
                'cancelAnimationFrame',
                'performance',
                'Date',
            ],
        });
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('updates on the next frame for the echo of typing, even with assistive technology', () => {
        let updates = 0;
        const scheduler = new UpdateScheduler(
            () => {
                updates += 1;
            },
            () => true,
        );
        scheduler.request();
        vi.advanceTimersByTime(10);
        scheduler.request();
        scheduler.input();
        scheduler.request();
        vi.advanceTimersToNextFrame();
        expect(updates).toBe(2);
    });

    it('keeps the 250 ms cadence for output that does not follow typing', () => {
        let updates = 0;
        const scheduler = new UpdateScheduler(
            () => {
                updates += 1;
            },
            () => true,
        );
        scheduler.input();
        vi.advanceTimersByTime(400);
        scheduler.request();
        vi.advanceTimersByTime(10);
        scheduler.request();
        vi.advanceTimersToNextFrame();
        expect(updates).toBe(1);
        vi.advanceTimersByTime(250);
        expect(updates).toBe(2);
    });

    it('holds still during a flood even while the user types', () => {
        let updates = 0;
        const scheduler = new UpdateScheduler(
            () => {
                updates += 1;
            },
            () => true,
        );
        scheduler.output(80 * 1024);
        scheduler.input();
        scheduler.request();
        vi.advanceTimersToNextFrame();
        expect(updates).toBe(0);
        vi.advanceTimersByTime(500);
        expect(updates).toBe(1);
    });
});
