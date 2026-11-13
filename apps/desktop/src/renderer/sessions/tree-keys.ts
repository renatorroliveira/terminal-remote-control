import type { TreeItem } from './workspace-model';

/** What a key press in the session tree does. */
export type TreeAction =
    | { readonly kind: 'focus'; readonly index: number }
    | { readonly kind: 'open'; readonly key: string }
    | { readonly kind: 'toggle'; readonly hostId: string }
    | { readonly kind: 'none' };

const NONE: TreeAction = { kind: 'none' };

/**
 * The APG tree view keys: Up and Down move, Home and End jump, Right expands a host or enters it, Left collapses a
 * host or returns to it, and Enter opens a session or toggles a host. Moving never opens (US-1.8.1).
 */
export function treeAction(items: readonly TreeItem[], index: number, key: string): TreeAction {
    const item = items[index];
    if (item === undefined) {
        return NONE;
    }
    switch (key) {
        case 'ArrowDown':
            return focus(items, index + 1);
        case 'ArrowUp':
            return focus(items, index - 1);
        case 'Home':
            return focus(items, 0);
        case 'End':
            return focus(items, items.length - 1);
        case 'ArrowRight':
            return right(item, index);
        case 'ArrowLeft':
            return left(items, item, index);
        case 'Enter':
        case ' ':
            return item.kind === 'session' ? { kind: 'open', key: item.key } : { kind: 'toggle', hostId: item.host.id };
        default:
            return NONE;
    }
}

/** The next row after `index` whose label starts with `prefix`, wrapping around (US-1.6.4). */
export function typeAhead(items: readonly TreeItem[], index: number, prefix: string): number | undefined {
    const wanted = prefix.toLocaleLowerCase();
    for (let step = 1; step <= items.length; step += 1) {
        const candidate = (index + step) % items.length;
        if (items[candidate]?.label.toLocaleLowerCase().startsWith(wanted) === true) {
            return candidate;
        }
    }
    return undefined;
}

function focus(items: readonly TreeItem[], index: number): TreeAction {
    return index >= 0 && index < items.length ? { kind: 'focus', index } : NONE;
}

function right(item: TreeItem, index: number): TreeAction {
    if (item.kind !== 'host') {
        return NONE;
    }
    return item.expanded ? { kind: 'focus', index: index + 1 } : { kind: 'toggle', hostId: item.host.id };
}

function left(items: readonly TreeItem[], item: TreeItem, index: number): TreeAction {
    if (item.kind === 'host') {
        return item.expanded ? { kind: 'toggle', hostId: item.host.id } : NONE;
    }
    const parent = items.findLastIndex((candidate, at) => at < index && candidate.kind === 'host');
    return parent < 0 ? NONE : { kind: 'focus', index: parent };
}
