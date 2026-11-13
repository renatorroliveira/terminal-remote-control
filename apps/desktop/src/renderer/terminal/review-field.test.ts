import { afterEach, describe, expect, it } from 'vitest';
import type { BufferText } from './buffer-text';
import { REVIEW_PAGE_LINES, ReviewField } from './review-field';

const fields: ReviewField[] = [];

afterEach(() => {
    for (const field of fields.splice(0)) {
        field.close();
    }
    document.body.replaceChildren();
});

function setUp(count: number, cursorLine = count - 1) {
    const state = { lines: Array.from({ length: count }, (_, index) => `line ${index}`), cursorLine };
    const closed: number[] = [];
    const notices: number[] = [];
    const host = document.createElement('div');
    document.body.append(host);
    const text = (): BufferText => ({
        lines: state.lines,
        firstRows: state.lines.map((_, index) => index),
        cursorLine: state.cursorLine,
    });
    const field = new ReviewField(host, text, {
        onClose: () => closed.push(1),
        onNewOutput: () => notices.push(1),
    });
    fields.push(field);
    return { field, state, closed, notices, host };
}

function caretLine(field: ReviewField): string {
    const { value, selectionStart } = field.element;
    const start = value.lastIndexOf('\n', selectionStart - 1) + 1;
    const end = value.indexOf('\n', selectionStart);
    return value.slice(start, end < 0 ? undefined : end);
}

function key(field: ReviewField, init: KeyboardEventInit): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    field.element.dispatchEvent(event);
    return event;
}

describe('ReviewField: the whole buffer as a read-only text field (A11Y-03)', () => {
    it('opens as a named, focused, read-only multi-line field with the caret on the cursor’s line', () => {
        const { field } = setUp(20, 12);
        field.open('Review build, devbox-1');
        expect(field.element.tagName).toBe('TEXTAREA');
        expect(field.element.readOnly).toBe(true);
        expect(field.element.getAttribute('aria-label')).toBe('Review build, devbox-1');
        expect(document.activeElement).toBe(field.element);
        expect(caretLine(field)).toBe('line 12');
    });

    it('holds a page of lines and pages on as the caret nears an edge, keeping the caret on its line', () => {
        const total = REVIEW_PAGE_LINES * 4;
        const { field } = setUp(total, REVIEW_PAGE_LINES * 2);
        field.open('Review');
        expect(field.element.value.split('\n')).toHaveLength(REVIEW_PAGE_LINES);
        const value = field.element.value;
        field.element.setSelectionRange(0, 0);
        field.element.dispatchEvent(new Event('select'));
        const top = value.split('\n')[0];
        expect(caretLine(field)).toBe(top);
        expect(field.element.value).not.toBe(value);
        expect(field.element.value.split('\n')[0]).not.toBe(top);
    });

    it('goes to the start and the end of the whole buffer, and the end picks up new output', () => {
        const total = REVIEW_PAGE_LINES * 3;
        const { field, state } = setUp(total, REVIEW_PAGE_LINES);
        field.open('Review');
        expect(key(field, { key: 'ArrowUp', metaKey: true }).defaultPrevented).toBe(true);
        expect(caretLine(field)).toBe('line 0');
        state.lines = [...state.lines, 'brand new'];
        key(field, { key: 'ArrowDown', metaKey: true });
        expect(caretLine(field)).toBe('brand new');
    });

    it('stays put when output arrives, notices it once until the user goes to the end, and closes on Escape', () => {
        const { field, state, notices, closed } = setUp(30, 5);
        field.open('Review');
        const value = field.element.value;
        state.lines = [...state.lines, 'more'];
        field.output();
        field.output();
        expect(field.element.value).toBe(value);
        expect(notices).toHaveLength(1);
        key(field, { key: 'ArrowDown', metaKey: true });
        field.output();
        expect(notices).toHaveLength(2);
        key(field, { key: 'Escape' });
        expect(closed).toHaveLength(1);
    });

    it('selects a range on a line anywhere in the buffer, paging to it', () => {
        const { field } = setUp(REVIEW_PAGE_LINES * 3, 0);
        field.open('Review');
        const line = REVIEW_PAGE_LINES * 2 + 7;
        field.select(line, 'line '.length, `line ${line}`.length);
        expect(field.element.value.slice(field.element.selectionStart, field.element.selectionEnd)).toBe(String(line));
    });
});
