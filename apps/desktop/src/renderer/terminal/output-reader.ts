import type { IBuffer, IDisposable, IMarker, Terminal } from '@xterm/xterm';

/** New output since the last read (A11Y-02.2). */
export interface OutputDelta {
    /** New text on the line the cursor was on at the last read, such as an echo or a command's first output. */
    readonly continued: string;
    /** The logical lines after it, up to the cursor's line, without blank ones and at most `limit` with `continued`. */
    readonly lines: readonly string[];
    /** How many lines have new text, `continued` included and counting past `limit`. */
    readonly count: number;
}

/** How to read. */
export interface ReadOptions {
    /** The most pieces of text to collect, `continued` included; lines past it are only counted. */
    readonly limit: number;
    /** Whether the user is editing the line: a rewritten line is then read from its first change. */
    readonly editing: boolean;
}

interface NormalMark {
    readonly marker: IMarker;
    readonly text: string;
}

interface CursorLine {
    readonly row: number;
    readonly text: string;
}

const NOTHING: OutputDelta = { continued: '', lines: [], count: 0 };
const CURSOR_VISIBILITY = 25;

/**
 * Reads a terminal's new output as logical lines: soft-wrapped rows joined, with the final text of lines that were
 * overwritten, redrawn or edited (A11Y-02.2). In a full-screen program it reads the line at the cursor when the
 * cursor moves to another line or that line changes, and nothing while the program hides the cursor (A11Y-02.5).
 */
export class OutputReader {
    readonly #terminal: Terminal;
    readonly #disposables: readonly IDisposable[];
    #mark: NormalMark | undefined;
    #cursorLine: CursorLine | undefined;
    #cursorVisible = true;

    /** A reader of `terminal`'s buffers. */
    constructor(terminal: Terminal) {
        this.#terminal = terminal;
        this.#disposables = [
            terminal.parser.registerCsiHandler({ prefix: '?', final: 'h' }, (params) => this.#cursorMode(params, true)),
            terminal.parser.registerCsiHandler({ prefix: '?', final: 'l' }, (params) =>
                this.#cursorMode(params, false),
            ),
        ];
    }

    /** What changed since the last read or skip. */
    read(options: ReadOptions): OutputDelta {
        const buffer = this.#terminal.buffer.active;
        if (buffer.type === 'alternate') {
            return this.#readCursorLine(buffer, options.editing);
        }
        this.#cursorLine = undefined;
        return this.#readNormal(buffer, options);
    }

    /** Forgets what changed: the next read starts from the cursor's line as it is now. */
    skip(): void {
        const buffer = this.#terminal.buffer.active;
        if (buffer.type === 'alternate') {
            this.#cursorLine = { row: buffer.cursorY, text: rowText(buffer, buffer.cursorY) };
            return;
        }
        const start = logicalStart(buffer, buffer.baseY + buffer.cursorY);
        this.#remark(buffer, start, logicalLine(buffer, start).text);
    }

    /** Stops tracking the terminal. */
    dispose(): void {
        this.#mark?.marker.dispose();
        for (const disposable of this.#disposables) {
            disposable.dispose();
        }
    }

    #readNormal(buffer: IBuffer, options: ReadOptions): OutputDelta {
        const cursor = logicalStart(buffer, buffer.baseY + buffer.cursorY);
        const markLine = this.#markLine(buffer, cursor);
        const collector = new LineCollector(options.limit);
        let row = markLine < 0 ? cursor : markLine;
        if (markLine >= 0) {
            const line = logicalLine(buffer, row);
            collector.continue(lineChange(this.#mark?.text ?? '', line.text, options.editing));
            row = line.next;
        }
        while (row <= cursor) {
            if (collector.full) {
                collector.count((buffer.getLine(row)?.translateToString(true) ?? '') !== '');
                row = logicalEnd(buffer, row);
            } else {
                const line = logicalLine(buffer, row);
                collector.add(line.text);
                row = line.next;
            }
        }
        this.#remark(buffer, cursor, logicalLine(buffer, cursor).text);
        return collector.delta();
    }

    #markLine(buffer: IBuffer, cursor: number): number {
        const marker = this.#mark?.marker;
        const line = marker === undefined || marker.isDisposed ? -1 : logicalStart(buffer, marker.line);
        return line > cursor ? -1 : line;
    }

    #readCursorLine(buffer: IBuffer, editing: boolean): OutputDelta {
        if (!this.#cursorVisible) {
            this.#cursorLine = undefined;
            return NOTHING;
        }
        const now = { row: buffer.cursorY, text: rowText(buffer, buffer.cursorY) };
        const before = this.#cursorLine;
        this.#cursorLine = now;
        const collector = new LineCollector(1);
        if (before === undefined || before.row !== now.row) {
            collector.add(now.text);
        } else {
            collector.continue(lineChange(before.text, now.text, editing));
        }
        return collector.delta();
    }

    #remark(buffer: IBuffer, line: number, text: string): void {
        this.#mark?.marker.dispose();
        const marker = this.#terminal.registerMarker(line - (buffer.baseY + buffer.cursorY));
        this.#mark = { marker, text };
    }

    #cursorMode(params: readonly (number | number[])[], visible: boolean): boolean {
        if (params.includes(CURSOR_VISIBILITY)) {
            this.#cursorVisible = visible;
        }
        return false;
    }
}

/** Gathers pieces of text up to a limit, and counts every line with text. */
class LineCollector {
    readonly #limit: number;
    readonly #lines: string[] = [];
    #continued = '';
    #count = 0;

    constructor(limit: number) {
        this.#limit = limit;
    }

    get full(): boolean {
        return this.#lines.length + (this.#continued === '' ? 0 : 1) >= this.#limit;
    }

    continue(text: string): void {
        this.#continued = text.trim();
        this.count(this.#continued !== '');
    }

    add(text: string): void {
        const trimmed = text.trim();
        if (trimmed !== '' && !this.full) {
            this.#lines.push(trimmed);
        }
        this.count(trimmed !== '');
    }

    count(hasText: boolean): void {
        this.#count += hasText ? 1 : 0;
    }

    delta(): OutputDelta {
        return { continued: this.#continued, lines: this.#lines, count: this.#count };
    }
}

/** The new text of a line that changed from `before` to `after`. */
function lineChange(before: string, after: string, editing: boolean): string {
    if (after.startsWith(before)) {
        return after.slice(before.length);
    }
    if (before.startsWith(after)) {
        return '';
    }
    return editing ? after.slice(commonPrefixLength(before, after)) : after;
}

function commonPrefixLength(a: string, b: string): number {
    let length = 0;
    while (length < a.length && a[length] === b[length]) {
        length += 1;
    }
    return length;
}

function logicalStart(buffer: IBuffer, row: number): number {
    let start = row;
    while (start > 0 && buffer.getLine(start)?.isWrapped === true) {
        start -= 1;
    }
    return start;
}

function logicalEnd(buffer: IBuffer, start: number): number {
    let next = start + 1;
    while (next < buffer.length && buffer.getLine(next)?.isWrapped === true) {
        next += 1;
    }
    return next;
}

function logicalLine(buffer: IBuffer, start: number): { readonly text: string; readonly next: number } {
    const next = logicalEnd(buffer, start);
    let text = '';
    for (let row = start; row < next; row += 1) {
        text += buffer.getLine(row)?.translateToString(row === next - 1) ?? '';
    }
    return { text: text.trimEnd(), next };
}

function rowText(buffer: IBuffer, row: number): string {
    return buffer.getLine(buffer.baseY + row)?.translateToString(true) ?? '';
}
