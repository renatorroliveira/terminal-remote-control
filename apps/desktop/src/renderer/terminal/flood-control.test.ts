import { describe, expect, it } from 'vitest';
import { FloodControl } from './flood-control';

function controlAt(threshold: number): { readonly flood: FloodControl; readonly at: (ms: number) => void } {
    let now = 0;
    const flood = new FloodControl(
        () => threshold,
        () => now,
    );
    return { flood, at: (ms) => (now = ms) };
}

describe('FloodControl: output faster than speech is summarized (A11Y-02.3)', () => {
    it('admits lines up to the threshold in one second', () => {
        const { flood, at } = controlAt(20);
        expect(flood.admit(12)).toBe(true);
        at(500);
        expect(flood.admit(8)).toBe(true);
        expect(flood.flooding).toBe(false);
    });

    it('holds lines past the threshold and counts them until output pauses', () => {
        const { flood, at } = controlAt(20);
        expect(flood.admit(15)).toBe(true);
        at(300);
        expect(flood.admit(10)).toBe(false);
        expect(flood.flooding).toBe(true);
        at(600);
        expect(flood.admit(300)).toBe(false);
        expect(flood.end()).toBe(310);
        expect(flood.flooding).toBe(false);
    });

    it('forgets lines older than a second', () => {
        const { flood, at } = controlAt(20);
        expect(flood.admit(20)).toBe(true);
        at(1_001);
        expect(flood.admit(20)).toBe(true);
    });

    it('holds one burst larger than the threshold', () => {
        const { flood } = controlAt(20);
        expect(flood.admit(21)).toBe(false);
        expect(flood.end()).toBe(21);
    });

    it('has nothing to report without a flood, and starts over after a reset', () => {
        const { flood } = controlAt(20);
        expect(flood.end()).toBeUndefined();
        flood.admit(50);
        flood.reset();
        expect(flood.flooding).toBe(false);
        expect(flood.end()).toBeUndefined();
        expect(flood.admit(20)).toBe(true);
    });

    it('follows a threshold the user changes', () => {
        let threshold = 20;
        const flood = new FloodControl(
            () => threshold,
            () => 0,
        );
        threshold = 5;
        expect(flood.admit(6)).toBe(false);
    });
});
