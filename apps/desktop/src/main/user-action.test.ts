import { describe, expect, it } from 'vitest';
import { USER_ACTION_WINDOW_MS, UserActionClock } from './user-action';

describe('UserActionClock: requests that must follow a user action (SEC-06)', () => {
    it('allows them for a few seconds after a key press or a menu choice, and not before one', () => {
        let now = 1_000;
        const clock = new UserActionClock(() => now);
        expect(clock.recent()).toBe(false);
        clock.note();
        now += USER_ACTION_WINDOW_MS;
        expect(clock.recent()).toBe(true);
        now += 1;
        expect(clock.recent()).toBe(false);
    });
});
