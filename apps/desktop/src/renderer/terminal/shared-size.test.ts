import { describe, expect, it } from 'vitest';
import { SharedSize } from './shared-size';

const ours = { cols: 120, rows: 40 };
const theirs = { cols: 80, rows: 24 };

function clocked() {
    const clock = { now: 0 };
    return { clock, size: new SharedSize(() => clock.now) };
}

describe('SharedSize (US-2.6.2, P-31)', () => {
    it('sends the size the frame fits while this client sets it, and knows its own sizes when they come back', () => {
        const { size } = clocked();
        expect(size.fitted(ours)).toEqual(ours);
        expect(size.fitted({ cols: 100, rows: 40 })).toEqual({ cols: 100, rows: 40 });
        expect(size.fitted({ cols: 100, rows: 40 })).toBeUndefined();
        size.session(ours);
        size.session({ cols: 100, rows: 40 });
        expect(size.foreign).toBe(false);
        expect(size.shown).toEqual({ cols: 100, rows: 40 });
    });

    it('shows the session at the size another client set, sends nothing, and takes the size back when asked', () => {
        const { size } = clocked();
        size.fitted(ours);
        size.session(theirs);
        expect(size.foreign).toBe(true);
        expect(size.shown).toEqual(theirs);
        expect(size.fitted({ cols: 110, rows: 40 })).toBeUndefined();
        expect(size.claim()).toEqual({ cols: 110, rows: 40 });
        expect(size.foreign).toBe(false);
        expect(size.claim()).toBeUndefined();
        size.session({ cols: 110, rows: 40 });
        expect(size.foreign).toBe(false);
    });

    it('forgets the sizes it asked for after a while, so an old one coming back is another client’s', () => {
        const { clock, size } = clocked();
        size.fitted(ours);
        size.fitted({ cols: 100, rows: 40 });
        clock.now = 60_000;
        size.session(ours);
        expect(size.foreign).toBe(true);
    });

    it('is not foreign when another client happens to set the size this one fits', () => {
        const { clock, size } = clocked();
        size.fitted(ours);
        clock.now = 60_000;
        size.session(theirs);
        size.session(ours);
        expect(size.foreign).toBe(false);
    });
});
