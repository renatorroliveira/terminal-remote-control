import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import graphemes from '@xterm/addon-unicode-graphemes';
import headless from '@xterm/headless';
import { describe, expect, it } from 'vitest';

const COLS = 80;
const ROWS = 24;
const CORPUS = resolve(import.meta.dirname, 'corpus');
const SAMPLES = readdirSync(CORPUS)
    .filter((name) => name.endsWith('.vt'))
    .map((name) => name.slice(0, -3));

/**
 * Samples where a program and the terminal disagree on a character's width, so the emulators legitimately differ in
 * an empty cell: vim writes 👍 and 🏽 as two cells with cursor moves between them (docs/spikes/S1.md).
 */
const WIDTH_DISAGREEMENTS: ReadonlySet<string> = new Set(['vim-alt']);

interface ScreenView {
    readonly type: string;
    readonly cursor: readonly [number, number];
    readonly rows: readonly string[];
    readonly widths: readonly string[];
}

async function render(data: Uint8Array): Promise<ScreenView> {
    const terminal = new headless.Terminal({ cols: COLS, rows: ROWS, allowProposedApi: true, scrollback: 10_000 });
    terminal.loadAddon(new graphemes.UnicodeGraphemesAddon());
    terminal.unicode.activeVersion = '15-graphemes';
    await new Promise<void>((done) => terminal.write(data, done));
    const buffer = terminal.buffer.active;
    const lines = Array.from({ length: ROWS }, (_, y) => buffer.getLine(buffer.viewportY + y));
    const view: ScreenView = {
        type: buffer.type,
        cursor: [buffer.cursorX, buffer.cursorY],
        rows: lines.map((line) => line?.translateToString(true) ?? ''),
        widths: lines.map((line) =>
            Array.from({ length: COLS }, (_, x) => String(line?.getCell(x)?.getWidth() ?? -1)).join(''),
        ),
    };
    terminal.dispose();
    return view;
}

const read = (name: string): Uint8Array => new Uint8Array(readFileSync(resolve(CORPUS, name)));

describe('libghostty-vt snapshots replay into xterm.js (US-1.11, S1)', () => {
    it.each(SAMPLES)('%s', async (name) => {
        const original = await render(read(`${name}.vt`));
        const replay = await render(read(`expected/${name}.snapshot`));
        const ghostty = JSON.parse(readFileSync(resolve(CORPUS, 'expected', `${name}.json`), 'utf8')) as {
            readonly cursor: readonly [number, number];
        };

        expect(replay.type).toBe(original.type);
        expect(replay.cursor).toEqual(original.cursor);
        expect(ghostty.cursor).toEqual(original.cursor);
        if (WIDTH_DISAGREEMENTS.has(name)) {
            expect(replay.rows.map((row) => row.trimEnd())).toEqual(original.rows.map((row) => row.trimEnd()));
        } else {
            expect(replay.rows).toEqual(original.rows);
            expect(replay.widths).toEqual(original.widths);
        }
    });
});
