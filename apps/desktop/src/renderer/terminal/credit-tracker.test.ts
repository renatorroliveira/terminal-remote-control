import { describe, expect, it } from 'vitest';
import { CreditTracker } from './credit-tracker';

describe('CreditTracker (D-19)', () => {
    it('returns credit in 64 KiB steps as xterm finishes parsing output', () => {
        const grants: number[] = [];
        const tracker = new CreditTracker((bytes) => grants.push(bytes));
        tracker.parsed(40 * 1024);
        expect(grants).toEqual([]);
        tracker.parsed(30 * 1024);
        expect(grants).toEqual([70 * 1024]);
        tracker.parsed(64 * 1024);
        expect(grants).toEqual([70 * 1024, 64 * 1024]);
    });

    it('drops credit still pending when it resets for a new stream (US-1.14.3)', () => {
        const grants: number[] = [];
        const tracker = new CreditTracker((bytes) => grants.push(bytes));
        tracker.parsed(40 * 1024);
        tracker.reset();
        tracker.parsed(40 * 1024);
        expect(grants).toEqual([]);
    });
});
