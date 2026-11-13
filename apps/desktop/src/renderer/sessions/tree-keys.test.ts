import { describe, expect, it } from 'vitest';
import { type TreeRow, treeAction } from './tree-keys';

const ROWS: readonly TreeRow[] = [
    { kind: 'host', key: 'h1', expanded: true, label: 'devbox' },
    { kind: 'session', key: 'h1/a', hostKey: 'h1', label: 'bash' },
    { kind: 'session', key: 'h1/b', hostKey: 'h1', label: 'build' },
    { kind: 'host', key: 'h2', expanded: false, label: 'staging' },
];

describe('treeAction: the APG tree keys (US-1.6.4)', () => {
    it('moves with Up, Down, Home and End, and never opens on a move (US-1.8.1)', () => {
        expect(treeAction(ROWS, 0, 'ArrowDown')).toEqual({ kind: 'focus', index: 1 });
        expect(treeAction(ROWS, 3, 'ArrowDown')).toEqual({ kind: 'none' });
        expect(treeAction(ROWS, 1, 'ArrowUp')).toEqual({ kind: 'focus', index: 0 });
        expect(treeAction(ROWS, 2, 'Home')).toEqual({ kind: 'focus', index: 0 });
        expect(treeAction(ROWS, 0, 'End')).toEqual({ kind: 'focus', index: 3 });
    });

    it('expands with Right and enters the host, collapses with Left and returns to the host', () => {
        expect(treeAction(ROWS, 3, 'ArrowRight')).toEqual({ kind: 'toggle', key: 'h2' });
        expect(treeAction(ROWS, 0, 'ArrowRight')).toEqual({ kind: 'focus', index: 1 });
        expect(treeAction(ROWS, 2, 'ArrowLeft')).toEqual({ kind: 'focus', index: 0 });
        expect(treeAction(ROWS, 0, 'ArrowLeft')).toEqual({ kind: 'toggle', key: 'h1' });
        expect(treeAction(ROWS, 3, 'ArrowLeft')).toEqual({ kind: 'none' });
    });

    it('opens a session and toggles a host with Enter or Space', () => {
        expect(treeAction(ROWS, 2, 'Enter')).toEqual({ kind: 'open', key: 'h1/b' });
        expect(treeAction(ROWS, 3, ' ')).toEqual({ kind: 'toggle', key: 'h2' });
    });
});
