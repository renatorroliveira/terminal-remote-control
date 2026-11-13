import { Terminal } from '@xterm/xterm';
import { afterEach, describe, expect, it } from 'vitest';
import { TerminalLinks } from './hyperlinks';

const disposables: { dispose(): void }[] = [];

afterEach(() => {
    for (const disposable of disposables.splice(0)) {
        disposable.dispose();
    }
});

function setUp(cols = 40) {
    const terminal = new Terminal({ cols, rows: 6, scrollback: 100, allowProposedApi: true });
    const activated: string[] = [];
    const links = new TerminalLinks(terminal, (link) => activated.push(link.target));
    disposables.push(links, terminal);
    const write = (text: string): Promise<void> => new Promise((resolve) => terminal.write(text, resolve));
    return { terminal, links, write, activated };
}

const osc8 = (target: string, text: string): string => `\u001b]8;;${target}\u001b\\${text}\u001b]8;;\u001b\\`;

describe('TerminalLinks: the link under a cell (US-1.12.3)', () => {
    it('finds a detected URL at any of its cells, and nothing beside it', async () => {
        const { links, write } = setUp();
        const line = 'go to https://example.com/docs now';
        await write(line);
        const first = line.indexOf('https');
        const last = first + 'https://example.com/docs'.length - 1;
        expect(links.linkAt(0, first)).toEqual({
            text: 'https://example.com/docs',
            target: 'https://example.com/docs',
        });
        expect(links.linkAt(0, last)?.target).toBe('https://example.com/docs');
        expect(links.linkAt(0, first - 1)).toBeUndefined();
        expect(links.linkAt(0, last + 1)).toBeUndefined();
    });

    it('finds a URL that wraps onto the next row', async () => {
        const { links, write } = setUp(20);
        await write('x https://example.com/a/long/path');
        expect(links.linkAt(1, 0)?.target).toBe('https://example.com/a/long/path');
    });

    it('counts a wide character before the URL as two columns', async () => {
        const { links, write } = setUp();
        const wide = '日本';
        await write(`${wide} https://example.com`);
        const urlColumn = [...wide].length * 2 + ' '.length;
        expect(links.linkAt(0, urlColumn)?.target).toBe('https://example.com');
        expect(links.linkAt(0, urlColumn - 1)).toBeUndefined();
    });

    it('finds an OSC 8 hyperlink by its text, with the target its text may hide', async () => {
        const { links, write } = setUp();
        const before = 'see ';
        const text = 'the docs';
        await write(`${before}${osc8('https://example.com/real', text)} today`);
        const end = before.length + text.length;
        expect(links.linkAt(0, before.length)).toEqual({ text, target: 'https://example.com/real' });
        expect(links.linkAt(0, end - 1)?.target).toBe('https://example.com/real');
        expect(links.linkAt(0, end)).toBeUndefined();
    });

    it('lists the links on the screen once each, hyperlinks first', async () => {
        const { links, write } = setUp();
        await write(`${osc8('file:///tmp/a.txt', 'a.txt')} https://example.com\r\nhttps://example.com again`);
        expect(links.visible()).toEqual([
            { text: 'a.txt', target: 'file:///tmp/a.txt' },
            { text: 'https://example.com', target: 'https://example.com' },
        ]);
    });

    it('forgets hyperlinks of a full-screen program when it exits', async () => {
        const { links, write } = setUp();
        await write(`\u001b[?1049h${osc8('https://example.com/tui', 'tui')}`);
        expect(links.linkAt(0, 0)?.target).toBe('https://example.com/tui');
        await write('\u001b[?1049l');
        expect(links.linkAt(0, 0)).toBeUndefined();
    });
});
