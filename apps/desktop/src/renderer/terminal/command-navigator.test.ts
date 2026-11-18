import { Terminal } from '@xterm/xterm';
import { afterEach, describe, expect, it } from 'vitest';
import { bufferText } from './buffer-text';
import { CommandMarks } from './command-marks';
import { CommandNavigator } from './command-navigator';
import { ReviewField } from './review-field';

const A = '\u001b]133;A\u0007';
const C = '\u001b]133;C\u0007';
const D = (code: number): string => `\u001b]133;D;${code}\u0007`;

const cleanups: (() => void)[] = [];

afterEach(() => {
    for (const cleanup of cleanups.splice(0)) {
        cleanup();
    }
    document.body.replaceChildren();
});

function setUp(rows = 5) {
    const terminal = new Terminal({ cols: 40, rows, scrollback: 1_000, allowProposedApi: true });
    const marks = new CommandMarks(terminal, { onFinished: () => undefined });
    const host = document.createElement('div');
    document.body.append(host);
    const review = new ReviewField(host, () => bufferText(terminal), {
        onClose: () => undefined,
        onNewOutput: () => undefined,
    });
    const navigator = new CommandNavigator(terminal, marks, () => review);
    cleanups.push(() => {
        review.close();
        marks.dispose();
        terminal.dispose();
    });
    return { terminal, review, navigator };
}

function write(terminal: Terminal, text: string): Promise<void> {
    return new Promise((resolve) => terminal.write(text, resolve));
}

function command(name: string, output: readonly string[], code: number): string {
    return `${A}$ ${name}\r\n${C}${output.map((line) => `${line}\r\n`).join('')}${D(code)}`;
}

const THREE = command('make', ['built'], 0) + command('make test', ['one', 'two'], 2) + command('ls', ['a'], 0);

describe('CommandNavigator: moving between commands (US-5.2.1)', () => {
    it('goes back command by command from the prompt, scrolling each to the top, then says it is at the first', async () => {
        const { terminal, navigator } = setUp();
        await write(terminal, `${THREE}${A}$ `);
        expect(navigator.step('previous')).toEqual({ kind: 'moved', line: '$ ls', exitCode: 0, running: false });
        expect(terminal.buffer.active.viewportY).toBe(terminal.buffer.active.baseY);
        expect(navigator.step('previous')).toMatchObject({ kind: 'moved', line: '$ make test', exitCode: 2 });
        expect(terminal.buffer.active.viewportY).toBe(2);
        expect(navigator.step('previous')).toMatchObject({ line: '$ make' });
        expect(navigator.step('previous')).toEqual({ kind: 'edge', direction: 'previous' });
        expect(navigator.step('next')).toMatchObject({ line: '$ make test' });
    });

    it('starts again from the prompt once the user types, and says when no later command follows', async () => {
        const { terminal, navigator } = setUp();
        await write(terminal, `${THREE}${A}$ `);
        navigator.step('previous');
        navigator.step('previous');
        navigator.reset();
        expect(navigator.step('previous')).toMatchObject({ line: '$ ls' });
        expect(navigator.step('next')).toEqual({ kind: 'edge', direction: 'next' });
    });

    it('moves the review caret from its own line, selecting each command’s line (A11Y-03)', async () => {
        const { terminal, review, navigator } = setUp();
        await write(terminal, `${THREE}${A}$ `);
        review.open('Review');
        expect(navigator.step('previous')).toMatchObject({ line: '$ ls' });
        const { value, selectionStart, selectionEnd } = review.element;
        expect(value.slice(selectionStart, selectionEnd)).toBe('$ ls');
        expect(navigator.step('previous')).toMatchObject({ line: '$ make test' });
        expect(review.caretLine()).toBe(2);
    });

    it('tells a running command apart, and is unavailable with no command or on the alternate screen', async () => {
        const { terminal, navigator } = setUp();
        expect(navigator.step('previous')).toEqual({ kind: 'unavailable', reason: 'none' });
        await write(terminal, `${A}$ sleep 9\r\n${C}`);
        expect(navigator.step('previous')).toEqual({
            kind: 'moved',
            line: '$ sleep 9',
            exitCode: undefined,
            running: true,
        });
        await write(terminal, '\u001b[?1049h');
        expect(navigator.step('next')).toEqual({ kind: 'unavailable', reason: 'full-screen' });
    });
});

describe('CommandNavigator: the last command’s output (US-5.2.1)', () => {
    it('reads a running command’s output so far, and the last finished one’s under a full-screen program', async () => {
        const { terminal, navigator } = setUp();
        await write(terminal, `${command('make test', ['one', 'two'], 2)}${A}$ `);
        expect(navigator.lastOutput()).toEqual({ kind: 'output', text: 'one\ntwo', lines: 2 });
        await write(terminal, `tail\r\n${C}load 1.0\r\n`);
        expect(navigator.lastOutput()).toEqual({ kind: 'output', text: 'load 1.0', lines: 1 });
        await write(terminal, '\u001b[?1049hvim screen');
        expect(navigator.lastOutput()).toEqual({ kind: 'output', text: 'one\ntwo', lines: 2 });
    });

    it('says the line the command was typed on, below a prompt of two lines', async () => {
        const { terminal, navigator } = setUp(10);
        const B = '\u001b]133;B\u0007';
        await write(terminal, `${A}~/proj main\r\n> ${B}make\r\n${C}built\r\n${D(0)}${A}~/proj main\r\n> ${B}`);
        expect(navigator.step('previous')).toMatchObject({ kind: 'moved', line: '> make' });
    });

    it('reads a long wrapped line as one line, and an empty output as no line', async () => {
        const { terminal, navigator } = setUp();
        const long = 'x'.repeat(70);
        await write(terminal, command('cat', [long], 0));
        expect(navigator.lastOutput()).toEqual({ kind: 'output', text: long, lines: 1 });
        await write(terminal, `${A}$ true\r\n${C}${D(0)}${A}$ `);
        expect(navigator.lastOutput()).toEqual({ kind: 'output', text: '', lines: 0 });
    });

    it('selects the output in the terminal, and in review mode while it is open', async () => {
        const { terminal, review, navigator } = setUp(10);
        const screen = document.createElement('div');
        document.body.append(screen);
        terminal.open(screen);
        await write(terminal, `${command('make test', ['one', 'two'], 2)}${A}$ `);
        expect(navigator.selectLastOutput()).toMatchObject({ kind: 'output', lines: 2 });
        expect(terminal.getSelection()).toBe('one\ntwo');
        review.open('Review');
        navigator.selectLastOutput();
        const { value, selectionStart, selectionEnd } = review.element;
        expect(value.slice(selectionStart, selectionEnd)).toBe('one\ntwo');
    });

    it('has no output to read before a command ran', async () => {
        const { terminal, navigator } = setUp();
        await write(terminal, `${A}$ `);
        expect(navigator.lastOutput()).toEqual({ kind: 'unavailable', reason: 'none' });
        expect(navigator.selectLastOutput()).toEqual({ kind: 'unavailable', reason: 'none' });
    });
});
