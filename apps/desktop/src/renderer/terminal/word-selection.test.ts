import { afterEach, describe, expect, it } from 'vitest';
import { trimTrailingSpace } from './word-selection';

function row(text: string): Text {
    const element = document.createElement('div');
    element.style.whiteSpace = 'pre';
    element.textContent = text;
    document.body.append(element);
    return element.firstChild as Text;
}

afterEach(() => {
    document.body.replaceChildren();
});

describe('trimTrailingSpace: a double-clicked word without the space after it (A11Y-04.1)', () => {
    it('drops the whitespace Windows adds after a double-clicked word', () => {
        const text = row('the quick brown fox');
        const selection = getSelection() as Selection;
        selection.setBaseAndExtent(text, 4, text, 10);
        expect(selection.toString()).toBe('quick ');
        trimTrailingSpace(selection);
        expect(selection.toString()).toBe('quick');
    });

    it('leaves a word without trailing space, a selection of whitespace, and a backward selection', () => {
        const text = row('the quick   brown');
        const selection = getSelection() as Selection;
        selection.setBaseAndExtent(text, 4, text, 9);
        trimTrailingSpace(selection);
        expect(selection.toString()).toBe('quick');
        selection.setBaseAndExtent(text, 9, text, 12);
        trimTrailingSpace(selection);
        expect(selection.toString()).toBe('   ');
        selection.setBaseAndExtent(text, 10, text, 4);
        trimTrailingSpace(selection);
        expect(selection.toString()).toBe('quick ');
    });
});
