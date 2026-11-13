import { Terminal } from '@xterm/xterm';
import { afterEach, describe, expect, it } from 'vitest';
import { OutputReader, type ReadOptions } from './output-reader';

const terminals: Terminal[] = [];
const readers: OutputReader[] = [];
const OUTPUT: ReadOptions = { limit: 100, editing: false };
const EDITING: ReadOptions = { limit: 100, editing: true };

afterEach(() => {
    for (const reader of readers.splice(0)) {
        reader.dispose();
    }
    for (const terminal of terminals.splice(0)) {
        terminal.dispose();
    }
});

function setUp(options: { readonly cols?: number; readonly scrollback?: number } = {}) {
    const terminal = new Terminal({
        cols: options.cols ?? 40,
        rows: 6,
        scrollback: options.scrollback ?? 1_000,
        allowProposedApi: true,
    });
    const reader = new OutputReader(terminal);
    terminals.push(terminal);
    readers.push(reader);
    const write = (text: string): Promise<void> => new Promise((resolve) => terminal.write(text, resolve));
    return { terminal, reader, write };
}

describe('OutputReader: new output as logical lines (A11Y-02.2)', () => {
    it('reads the lines printed since the last read, without blank ones', async () => {
        const { reader, write } = setUp();
        await write('$ ');
        reader.skip();
        await write('make\r\nok\r\n\r\ndone\r\n$ ');
        expect(reader.read(OUTPUT)).toEqual({ continued: 'make', lines: ['ok', 'done', '$'], count: 4 });
        expect(reader.read(OUTPUT)).toEqual({ continued: '', lines: [], count: 0 });
    });

    it('joins soft-wrapped rows into one line', async () => {
        const { reader, write } = setUp({ cols: 10 });
        reader.skip();
        await write('abcde fghij klmno\r\n');
        expect(reader.read(OUTPUT).continued).toBe('abcde fghij klmno');
    });

    it('collapses carriage-return overwrites and cursor moves to the final text of the line', async () => {
        const { reader, write } = setUp();
        reader.skip();
        await write('\r\nProgress 10%\rProgress 50%\rProgress 100%\u001b[3D\u001b[3C\r\n');
        expect(reader.read(OUTPUT).lines).toEqual(['Progress 100%']);
    });

    it('reads nothing when the line only shrank, as Backspace makes it', async () => {
        const { reader, write } = setUp();
        await write('$ ls');
        reader.skip();
        await write('\b \b');
        expect(reader.read(OUTPUT)).toEqual({ continued: '', lines: [], count: 0 });
    });

    it('reads a rewritten line whole, or from the first change while the user edits it', async () => {
        const { reader, write } = setUp();
        await write('$ ls -la');
        reader.skip();
        await write('\r$ cat notes');
        expect(reader.read(OUTPUT).continued).toBe('$ cat notes');
        await write('\r\u001b[K$ cat todo');
        expect(reader.read(EDITING).continued).toBe('todo');
    });

    it('stops collecting text at the limit and still counts every line', async () => {
        const { reader, write } = setUp();
        reader.skip();
        await write(`${Array.from({ length: 30 }, (_, index) => `line ${index}`).join('\r\n')}\r\n`);
        const delta = reader.read({ limit: 3, editing: false });
        expect(delta.continued).toBe('line 0');
        expect(delta.lines).toEqual(['line 1', 'line 2']);
        expect(delta.count).toBe(30);
    });

    it('starts again at the cursor after the screen and scrollback are cleared', async () => {
        const { reader, write } = setUp();
        await write('one\r\ntwo\r\nthree\r\n$ ');
        reader.skip();
        await write('\u001b[H\u001b[2J\u001b[3J$ ');
        expect(reader.read(OUTPUT).lines).toEqual(['$']);
    });

    it('starts again at the cursor when its mark scrolled out of the scrollback', async () => {
        const { reader, write } = setUp({ scrollback: 2 });
        reader.skip();
        await write(`${Array.from({ length: 20 }, (_, index) => `row ${index}`).join('\r\n')}`);
        expect(reader.read(OUTPUT).lines).toEqual(['row 19']);
    });
});

describe('OutputReader: the line at the cursor of a full-screen program (A11Y-02.5)', () => {
    it('reads the cursor line when the program starts and when the cursor moves to another line', async () => {
        const { reader, write } = setUp();
        reader.skip();
        await write('\u001b[?1049h\u001b[Hline one\r\nline two');
        expect(reader.read(OUTPUT).lines).toEqual(['line two']);
        await write('\u001b[A\u001b[3D');
        expect(reader.read(OUTPUT).lines).toEqual(['line one']);
    });

    it('reads nothing for a repaint that leaves the cursor line as it was', async () => {
        const { reader, write } = setUp();
        reader.skip();
        await write('\u001b[?1049h\u001b[Hline one\r\nline two');
        reader.read(OUTPUT);
        await write('\u001b[H\u001b[2Jline one\r\nline two');
        expect(reader.read(OUTPUT)).toEqual({ continued: '', lines: [], count: 0 });
    });

    it('reads what changed on the cursor line', async () => {
        const { reader, write } = setUp();
        reader.skip();
        await write('\u001b[?1049h\u001b[Hhello');
        reader.read(OUTPUT);
        await write(' world');
        expect(reader.read(EDITING).continued).toBe('world');
    });

    it('reads nothing while the program hides the cursor', async () => {
        const { reader, write } = setUp();
        reader.skip();
        await write('\u001b[?1049h\u001b[?25l\u001b[HCPU 12%');
        expect(reader.read(OUTPUT).count).toBe(0);
        await write('\u001b[?25h');
        expect(reader.read(OUTPUT).lines).toEqual(['CPU 12%']);
    });

    it('goes back to the shell lines after the program exits, without repeating them', async () => {
        const { reader, write } = setUp();
        await write('$ vim\r\n');
        reader.skip();
        await write('\u001b[?1049h\u001b[Htext');
        reader.read(OUTPUT);
        await write('\u001b[?1049l$ ');
        expect(reader.read(OUTPUT)).toEqual({ continued: '$', lines: [], count: 1 });
    });
});
