import { describe, expect, it } from 'vitest';
import { type CellLine, columnToOffset, minimalEdit, offsetToColumn, rowsToRender } from './text-geometry';

function line(cells: readonly [string, number][]): CellLine {
    return { cell: (x) => (x < cells.length ? { chars: cells[x]?.[0] ?? '', width: cells[x]?.[1] ?? 1 } : undefined) };
}

const wide = line([
    ['a', 1],
    ['日', 2],
    ['', 0],
    ['b', 1],
    ['👍🏽', 2],
    ['', 0],
    ['c', 1],
]);

describe('columnToOffset and offsetToColumn', () => {
    it('map grid columns to text offsets across wide cells and grapheme clusters', () => {
        expect([0, 1, 2, 3, 4, 5, 6, 7].map((column) => columnToOffset(wide, column, 7))).toEqual([
            0, 1, 2, 2, 3, 7, 7, 8,
        ]);
        expect([0, 1, 2, 3, 7, 8].map((offset) => offsetToColumn(wide, offset, 7))).toEqual([0, 1, 3, 4, 6, 7]);
    });

    it('treats empty cells as one space', () => {
        const blank = line([
            ['', 1],
            ['x', 1],
        ]);
        expect(columnToOffset(blank, 2, 2)).toBe(2);
    });
});

describe('minimalEdit', () => {
    it('replaces only the changed middle, so a caret elsewhere in the row keeps its offset', () => {
        expect(minimalEdit('$ ls -la', '$ ls -lah')).toEqual({ start: 8, deleteCount: 0, insert: 'h' });
        expect(minimalEdit('hello world', 'hello there world')).toEqual({ start: 6, deleteCount: 0, insert: 'there ' });
        expect(minimalEdit('abc', 'xyz')).toEqual({ start: 0, deleteCount: 3, insert: 'xyz' });
        expect(minimalEdit('same', 'same')).toEqual({ start: 4, deleteCount: 0, insert: '' });
        expect(minimalEdit('aaa', 'aa')).toEqual({ start: 2, deleteCount: 1, insert: '' });
    });
});

describe('rowsToRender (A11Y-04.7)', () => {
    it('renders the viewport', () => {
        expect(rowsToRender({ viewportY: 10, rows: 3, selection: undefined, cap: 5_000 })).toEqual([10, 11, 12]);
    });

    it('adds every selected row up to the cap', () => {
        expect(rowsToRender({ viewportY: 100, rows: 2, selection: { startRow: 2, endRow: 4 }, cap: 5_000 })).toEqual([
            2, 3, 4, 100, 101,
        ]);
        expect(rowsToRender({ viewportY: 0, rows: 1, selection: { startRow: 10, endRow: 50 }, cap: 3 })).toEqual([
            0, 10, 11, 12,
        ]);
    });
});
