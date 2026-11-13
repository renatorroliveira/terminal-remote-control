import { describe, expect, it } from 'vitest';
import { assistiveTechnologyActive, screenReaderOn } from './accessibility';

describe('screen-reader mode (A11Y-10.2)', () => {
    it('is on when assistive technology is detected in automatic mode, or when the user forces it', () => {
        expect(screenReaderOn({ supportEnabled: true, mode: 'auto' })).toBe(true);
        expect(screenReaderOn({ supportEnabled: false, mode: 'auto' })).toBe(false);
        expect(screenReaderOn({ supportEnabled: false, mode: 'on' })).toBe(true);
        expect(screenReaderOn({ supportEnabled: true, mode: 'off' })).toBe(false);
    });

    it('keeps the assistive-technology cadence while Chromium serves assistive technology, even when forced off', () => {
        expect(assistiveTechnologyActive({ supportEnabled: true, mode: 'off' })).toBe(true);
        expect(assistiveTechnologyActive({ supportEnabled: false, mode: 'on' })).toBe(true);
        expect(assistiveTechnologyActive({ supportEnabled: false, mode: 'auto' })).toBe(false);
    });
});
