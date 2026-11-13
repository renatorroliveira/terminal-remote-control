import { Terminal } from '@xterm/xterm';
import { afterEach, describe, expect, it } from 'vitest';
import { bufferText } from './buffer-text';
import { type FindMatch, type FindOptions, findMatches } from './find';

function matchesOf(lines: readonly string[], query: string, options: FindOptions): readonly FindMatch[] {
    const matches = findMatches(lines, query, options);
    if (matches === 'invalid') {
        throw new Error(`invalid query ${query}`);
    }
    return matches;
}

const terminals: Terminal[] = [];

afterEach(() => {
    for (const terminal of terminals.splice(0)) {
        terminal.dispose();
    }
});

async function terminalWith(text: string, cols = 20): Promise<Terminal> {
    const terminal = new Terminal({ cols, rows: 5, scrollback: 100, allowProposedApi: true });
    terminals.push(terminal);
    await new Promise<void>((resolve) => terminal.write(text, resolve));
    return terminal;
}

describe('bufferText: the scrollback and screen as logical lines (A11Y-03.4)', () => {
    it('joins soft-wrapped rows, trims trailing blanks, and knows the cursor’s line and each line’s first row', async () => {
        const cols = 20;
        const long = 'a'.repeat(cols + 10);
        const terminal = await terminalWith(`first   \r\n${long}\r\n$ `, cols);
        const text = bufferText(terminal);
        expect(text.lines.slice(0, 3)).toEqual(['first', long, '$']);
        expect(text.cursorLine).toBe(2);
        expect(text.firstRows.slice(0, 3)).toEqual([0, 1, 1 + Math.ceil(long.length / cols)]);
    });

    it('reads wide and combining characters as they were printed', async () => {
        const terminal = await terminalWith('日本 é 👍');
        expect(bufferText(terminal).lines[0]).toBe('日本 é 👍');
    });
});

describe('findMatches: searching the buffer (US-1.13.1)', () => {
    const lines = ['Error: disk full', 'error again', 'all good', 'ERROR x2 error'];

    it('finds every match ignoring case unless asked, in reading order', () => {
        const word = 'error';
        const last = lines[3]?.lastIndexOf(word) ?? -1;
        expect(findMatches(lines, word, { caseSensitive: false, regex: false })).toEqual([
            { line: 0, start: 0, end: word.length },
            { line: 1, start: 0, end: word.length },
            { line: 3, start: 0, end: word.length },
            { line: 3, start: last, end: last + word.length },
        ]);
        expect(findMatches(lines, 'error', { caseSensitive: true, regex: false })).toHaveLength(2);
    });

    it('takes a regular expression when asked, and reports one it cannot read', () => {
        expect(matchesOf(lines, 'disk|good', { caseSensitive: false, regex: true }).map((match) => match.line)).toEqual(
            [0, 2],
        );
        expect(findMatches(lines, 'a.b', { caseSensitive: false, regex: false })).toEqual([]);
        expect(findMatches(lines, '(', { caseSensitive: false, regex: true })).toBe('invalid');
    });

    it('finds nothing for an empty query, and never loops on an empty match', () => {
        expect(findMatches(lines, '', { caseSensitive: false, regex: false })).toEqual([]);
        expect(
            matchesOf(lines, 'x*', { caseSensitive: false, regex: true }).every((match) => match.end > match.start),
        ).toBe(true);
    });
});
