import { Terminal } from '@xterm/xterm';
import { afterEach, describe, expect, it } from 'vitest';
import { CommandMarks, MAX_COMMANDS } from './command-marks';

const A = '\u001b]133;A\u0007';
const B = '\u001b]133;B\u0007';
const C = '\u001b]133;C\u0007';
const D = (code?: number): string => `\u001b]133;D${code === undefined ? '' : `;${code}`}\u0007`;
const SET_MARK = '\u001b]1337;SetMark\u0007';

const terminals: Terminal[] = [];

afterEach(() => {
    for (const terminal of terminals.splice(0)) {
        terminal.dispose();
    }
});

function marked(scrollback = 100): { terminal: Terminal; marks: CommandMarks; finished: (number | undefined)[] } {
    const terminal = new Terminal({ cols: 40, rows: 5, scrollback, allowProposedApi: true });
    terminals.push(terminal);
    const finished: (number | undefined)[] = [];
    const marks = new CommandMarks(terminal, { onFinished: (exitCode) => finished.push(exitCode) });
    return { terminal, marks, finished };
}

function write(terminal: Terminal, text: string): Promise<void> {
    return new Promise((resolve) => terminal.write(text, resolve));
}

function command(name: string, output: string, code: number): string {
    return `${A}$ ${B}${name}\r\n${C}${output}${D(code)}`;
}

describe('CommandMarks: commands as shell integration marks them (US-5.1.2, US-5.2)', () => {
    it('keeps each command’s prompt, output and exit code on their rows, and reports each end', async () => {
        const { terminal, marks, finished } = marked();
        await write(terminal, `${command('make', 'built\r\n', 0)}${command('make test', 'one\r\ntwo\r\n', 2)}${A}$ `);
        const rows = marks.commands.map((entry) => [
            entry.prompt.marker.line,
            entry.output?.marker.line,
            entry.exitCode,
        ]);
        expect(rows).toEqual([
            [0, 1, 0],
            [2, 3, 2],
            [5, undefined, undefined],
        ]);
        expect(finished).toEqual([0, 2]);
    });

    it('counts a prompt redrawn on its row once, and an end without a start, or a second start, not at all', async () => {
        const { terminal, marks, finished } = marked();
        await write(terminal, `${A}$ \r${A}$ ${D(1)}${B}ls\r\n${C}${C}x\r\n${D(0)}${D(5)}`);
        expect(marks.commands).toHaveLength(1);
        expect(marks.commands[0]?.output?.marker.line).toBe(1);
        expect(marks.commands[0]?.exitCode).toBe(0);
        expect(finished).toEqual([0]);
    });

    it('takes an end without a status, and only primary prompts, ignoring options it does not need', async () => {
        const { terminal, marks, finished } = marked();
        await write(terminal, `\u001b]133;A;special_key=1\u0007$ ls\r\n\u001b]133;A;k=s\u0007> \r\n`);
        await write(terminal, `\u001b]133;C;cmdline_url=ls\u0007x\r\n${D()}`);
        expect(marks.commands.map((entry) => entry.prompt.marker.line)).toEqual([0]);
        expect(finished).toEqual([undefined]);
    });

    it('marks a row for iTerm2’s SetMark, with no command (OQ-6)', async () => {
        const { terminal, marks } = marked();
        await write(terminal, `one\r\n${SET_MARK}two\r\n\u001b]1337;CurrentDir=/srv\u0007`);
        expect(marks.commands.map((entry) => [entry.prompt.marker.line, entry.bookmark])).toEqual([[1, true]]);
    });

    it('reports no end while held, as in a replay, and again once released', async () => {
        const { terminal, marks, finished } = marked();
        marks.hold();
        await write(terminal, command('make', 'x\r\n', 1));
        marks.release();
        await write(terminal, command('make', 'y\r\n', 3));
        expect(marks.commands).toHaveLength(2);
        expect(finished).toEqual([3]);
    });

    it('marks nothing on the alternate screen, and forgets every command on reset', async () => {
        const { terminal, marks } = marked();
        await write(terminal, `\u001b[?1049h${command('vim', 'x\r\n', 0)}\u001b[?1049l`);
        expect(marks.commands).toEqual([]);
        await write(terminal, command('ls', 'x\r\n', 0));
        marks.reset();
        expect(marks.commands).toEqual([]);
    });

    it('lets a prompt where no command ran give way to the next, so empty Returns push no command out', async () => {
        const { terminal, marks } = marked(MAX_COMMANDS * 3);
        await write(terminal, command('make', 'x\r\n', 0));
        await write(terminal, `${A}$ \r\n`.repeat(MAX_COMMANDS + 10));
        await write(terminal, `${A}$ `);
        expect(marks.commands.map((entry) => entry.output !== undefined)).toEqual([true, false]);
    });

    it('turns a SetMark into the prompt that follows on its row, so that command still counts', async () => {
        const { terminal, marks, finished } = marked();
        await write(terminal, `${SET_MARK}${A}$ ${B}ls\r\n${C}x\r\n${D(1)}`);
        expect(marks.commands.map((entry) => [entry.bookmark, entry.exitCode, entry.input])).toEqual([
            [false, 1, undefined],
        ]);
        expect(finished).toEqual([1]);
    });

    it('drops the commands the scrollback trimmed, and keeps at most the newest MAX_COMMANDS', async () => {
        const { terminal, marks } = marked(10);
        for (let index = 0; index < 12; index += 1) {
            await write(terminal, command(`c${index}`, 'x\r\n', 0));
        }
        expect(marks.commands.length).toBeLessThan(12);
        expect(marks.commands.every((entry) => entry.prompt.marker.line >= 0)).toBe(true);
        const big = marked(MAX_COMMANDS * 3);
        await write(big.terminal, Array.from({ length: MAX_COMMANDS + 5 }, () => command('c', '', 0)).join(''));
        expect(big.marks.commands).toHaveLength(MAX_COMMANDS);
    });
});
