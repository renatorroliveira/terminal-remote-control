/** Whether a key press opens a context menu: Shift+F10 or the Menu key (A11Y-11.11). */
export function opensContextMenu(event: Pick<KeyboardEvent, 'key' | 'shiftKey'>): boolean {
    return event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey);
}

/** Tells apart the `contextmenu` event that repeats a Menu key press the app already handled. */
export interface MenuKeyEcho {
    /** Notes every key press: a Menu key press that opened a menu, or any other, which ends the wait. */
    pressed(event: Pick<KeyboardEvent, 'key'>): void;
    /** Whether `event` is the Menu key's own `contextmenu`, to be ignored; each Menu key press has at most one. */
    echoes(event: Pick<MouseEvent, 'button'>): boolean;
}

/**
 * Windows sends a `contextmenu` event, with no button (-1), when the Menu key is released, after the key press already
 * opened the menu, so that one is ignored. Any other is kept: a secondary click, and the one UI Automation's
 * ShowContextMenu sends with no key press at all.
 */
export function menuKeyEcho(): MenuKeyEcho {
    let pending = false;
    return {
        pressed: (event) => {
            pending = event.key === 'ContextMenu';
        },
        echoes: (event) => {
            const echo = pending && event.button === -1;
            pending = false;
            return echo;
        },
    };
}
