/** What a key press in a session list does. */
export type ListAction =
    | { readonly kind: 'focus'; readonly index: number }
    | { readonly kind: 'open'; readonly index: number }
    | { readonly kind: 'none' };

const NONE: ListAction = { kind: 'none' };

/**
 * The APG listbox keys, with selection apart from focus: Up and Down move, Home and End jump, and Enter or Space
 * opens the focused session. Moving never opens (US-1.8.1).
 */
export function listAction(count: number, index: number, key: string): ListAction {
    switch (key) {
        case 'ArrowDown':
            return focus(count, index + 1);
        case 'ArrowUp':
            return focus(count, index - 1);
        case 'Home':
            return focus(count, 0);
        case 'End':
            return focus(count, count - 1);
        case 'Enter':
        case ' ':
            return index >= 0 && index < count ? { kind: 'open', index } : NONE;
        default:
            return NONE;
    }
}

/** The next label after `index` that starts with `prefix`, wrapping around (US-1.6.4). */
export function typeAhead(labels: readonly string[], index: number, prefix: string): number | undefined {
    const wanted = prefix.toLocaleLowerCase();
    for (let step = 1; step <= labels.length; step += 1) {
        const candidate = (index + step) % labels.length;
        if (labels[candidate]?.toLocaleLowerCase().startsWith(wanted) === true) {
            return candidate;
        }
    }
    return undefined;
}

function focus(count: number, index: number): ListAction {
    return index >= 0 && index < count ? { kind: 'focus', index } : NONE;
}
