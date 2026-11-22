import { describe, expect, it } from 'vitest';
import { backgroundWindowOptions } from './background-window';

describe('backgroundWindowOptions (P-14, D-27)', () => {
    const workArea = { x: 0, y: 25, width: 1512, height: 920 };

    it('opens a test window transparent, in the bottom-right corner of the work area', () => {
        expect(backgroundWindowOptions(workArea, { width: 1200, height: 800 })).toEqual({
            x: 312,
            y: 145,
            width: 1200,
            height: 800,
            opacity: 0,
            skipTaskbar: true,
        });
    });

    it('keeps a window larger than the work area at its top-left corner', () => {
        expect(backgroundWindowOptions(workArea, { width: 2000, height: 1000 })).toMatchObject({ x: 0, y: 25 });
    });
});
