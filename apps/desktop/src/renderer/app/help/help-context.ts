import { REGION_ATTRIBUTE } from '../regions';

/** Where accessibility help was asked for, which picks the shortcuts it lists first (A11Y-10.1). */
export type HelpContext = 'terminal' | 'review' | 'sessions' | 'general';

/** The context of the element that had focus: review mode, the terminal, the session list, or anywhere else. */
export function helpContext(focused: Element | null): HelpContext {
    if (focused === null) {
        return 'general';
    }
    if (focused.closest('[data-review]') !== null) {
        return 'review';
    }
    if (focused.closest(`[${REGION_ATTRIBUTE}="terminal"]`) !== null && focused.getAttribute('role') === 'textbox') {
        return 'terminal';
    }
    return focused.closest('[role="tree"]') === null ? 'general' : 'sessions';
}
