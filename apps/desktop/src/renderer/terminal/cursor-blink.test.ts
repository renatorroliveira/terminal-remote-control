import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BLINK_IDLE_MS, CursorBlink } from './cursor-blink';

describe('CursorBlink: the cursor blinks only while wanted and active (A11Y-08.1)', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    function setUp() {
        const options = { cursorBlink: false };
        return { options, blink: new CursorBlink(options) };
    }

    it('blinks when asked, and stops after 5 seconds without input until the next key', () => {
        const { options, blink } = setUp();
        blink.set({ wanted: true, reducedMotion: false });
        expect(options.cursorBlink).toBe(true);
        vi.advanceTimersByTime(BLINK_IDLE_MS - 1);
        expect(options.cursorBlink).toBe(true);
        vi.advanceTimersByTime(1);
        expect(options.cursorBlink).toBe(false);
        blink.input();
        expect(options.cursorBlink).toBe(true);
    });

    it('never blinks while the OS reduces motion, or when the user turned blinking off', () => {
        const { options, blink } = setUp();
        blink.set({ wanted: true, reducedMotion: true });
        blink.input();
        expect(options.cursorBlink).toBe(false);
        blink.set({ wanted: false, reducedMotion: false });
        blink.input();
        expect(options.cursorBlink).toBe(false);
    });
});
