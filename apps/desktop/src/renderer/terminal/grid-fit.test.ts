import { describe, expect, it } from 'vitest';
import { fitGrid, glyphSpacing } from './grid-fit';

const cell = { width: 8.5, height: 17 };

describe('fitGrid (A11Y-07.4, A11Y-07.5)', () => {
    it('caps the columns at the maximum and fills the height with rows', () => {
        expect(fitGrid({ width: 2000, height: 700, cell, scrollbar: 14, maxColumns: 120 })).toEqual({
            cols: 120,
            rows: 41,
            width: 120 * 8.5 + 14,
        });
    });

    it('drops columns when the space or a zoom leaves less room', () => {
        expect(fitGrid({ width: 500, height: 100, cell, scrollbar: 14, maxColumns: 120 })).toEqual({
            cols: 57,
            rows: 5,
            width: 57 * 8.5 + 14,
        });
    });

    it('never goes below two columns and one row', () => {
        expect(fitGrid({ width: 0, height: 0, cell, scrollbar: 14, maxColumns: 120 })).toEqual({
            cols: 2,
            rows: 1,
            width: 2 * 8.5 + 14,
        });
    });

    it('has no size until the cell is measured', () => {
        expect(
            fitGrid({ width: 800, height: 600, cell: { width: 0, height: 0 }, scrollbar: 14, maxColumns: 120 }),
        ).toBe(undefined);
    });
});

describe('glyphSpacing', () => {
    it('widens device-pixel cells so a glyph is never cut, at any pixel ratio', () => {
        expect(glyphSpacing(8.6, 1)).toBe(1);
        expect(glyphSpacing(8.6, 2)).toBe(1);
        expect(glyphSpacing(8, 1)).toBe(0);
        expect(glyphSpacing(8, 2)).toBe(0);
    });
});
