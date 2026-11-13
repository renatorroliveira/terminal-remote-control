/** One visible row of the session tree: a host, or one of an expanded host's sessions. */
export type TreeRow =
    | { readonly kind: 'host'; readonly key: string; readonly expanded: boolean; readonly label: string }
    | { readonly kind: 'session'; readonly key: string; readonly hostKey: string; readonly label: string };

/** What a key press on a tree row does. */
export type TreeAction =
    | { readonly kind: 'focus'; readonly index: number }
    | { readonly kind: 'toggle'; readonly key: string }
    | { readonly kind: 'open'; readonly key: string }
    | { readonly kind: 'none' };

const NONE: TreeAction = { kind: 'none' };

/**
 * The APG tree keys (US-1.6.4): Up and Down move, Home and End jump, Right expands a host or enters it, Left
 * collapses it or returns from a session to its host, and Enter or Space opens a session or toggles a host. Moving
 * never opens (US-1.8.1).
 */
export function treeAction(rows: readonly TreeRow[], index: number, key: string): TreeAction {
    const row = rows[index];
    if (row === undefined) {
        return NONE;
    }
    switch (key) {
        case 'ArrowDown':
            return focus(rows, index + 1);
        case 'ArrowUp':
            return focus(rows, index - 1);
        case 'Home':
            return focus(rows, 0);
        case 'End':
            return focus(rows, rows.length - 1);
        case 'ArrowRight':
            return right(rows, row, index);
        case 'ArrowLeft':
            return left(rows, row);
        case 'Enter':
        case ' ':
            return row.kind === 'host' ? { kind: 'toggle', key: row.key } : { kind: 'open', key: row.key };
        default:
            return NONE;
    }
}

function right(rows: readonly TreeRow[], row: TreeRow, index: number): TreeAction {
    if (row.kind !== 'host') {
        return NONE;
    }
    return row.expanded ? focus(rows, index + 1, row.key) : { kind: 'toggle', key: row.key };
}

function left(rows: readonly TreeRow[], row: TreeRow): TreeAction {
    if (row.kind === 'session') {
        return focus(
            rows,
            rows.findIndex((candidate) => candidate.key === row.hostKey),
        );
    }
    return row.expanded ? { kind: 'toggle', key: row.key } : NONE;
}

function focus(rows: readonly TreeRow[], index: number, parent?: string): TreeAction {
    const target = rows[index];
    if (target === undefined || (parent !== undefined && (target.kind !== 'session' || target.hostKey !== parent))) {
        return NONE;
    }
    return { kind: 'focus', index };
}
