import { describe, expect, it } from 'vitest';
import { Pacer } from './pacer';

describe('Pacer: at most one request an interval (SEC-06)', () => {
    it('allows the first request, refuses the next within the interval, and allows one after it', () => {
        let now = 1_000;
        const pacer = new Pacer(500, () => now);
        expect(pacer.allow()).toBe(true);
        now += 499;
        expect(pacer.allow()).toBe(false);
        now += 1;
        expect(pacer.allow()).toBe(true);
    });
});
