import { describe, expect, it } from 'vitest';
import { parseChord } from '../../../shared/keymap';
import { shortcutRefusal } from './shortcut-refusal';

function chord(text: string) {
    const parsed = parseChord(text);
    if (parsed === undefined) {
        throw new Error(text);
    }
    return parsed;
}

describe('shortcutRefusal: why a recorded shortcut cannot be kept (A11Y-05.6, A11Y-05.7)', () => {
    it('names the broken rule, or the command that owns the shortcut, and keeps a free one', () => {
        const none = { shortcuts: {}, plainF6: false };
        expect(shortcutRefusal(none, 'terminal.find', chord('Ctrl+C'))).toEqual({ problem: 'control-code' });
        expect(shortcutRefusal(none, 'terminal.find', chord('Shift+Cmd+P'))).toEqual({ owner: 'palette.show' });
        expect(
            shortcutRefusal({ shortcuts: { 'review.toggle': 'F7' }, plainF6: false }, 'terminal.find', chord('F7')),
        ).toEqual({
            owner: 'review.toggle',
        });
        expect(shortcutRefusal({ shortcuts: {}, plainF6: true }, 'terminal.find', chord('F6'))).toEqual({
            owner: 'region.next',
        });
        expect(shortcutRefusal(none, 'terminal.find', chord('Cmd+F'))).toBeUndefined();
        expect(shortcutRefusal(none, 'terminal.find', chord('F7'))).toBeUndefined();
    });
});
