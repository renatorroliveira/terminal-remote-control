import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdateScheduler } from './update-scheduler';

describe('UpdateScheduler (S3a cadence, R2)', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'performance', 'Date'] });
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
