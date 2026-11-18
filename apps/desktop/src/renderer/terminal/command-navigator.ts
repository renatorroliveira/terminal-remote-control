import type { IBuffer, Terminal } from '@xterm/xterm';
import { type BufferCell, LogicalText, logicalLine, logicalStart } from './buffer-lines';
import { bufferText } from './buffer-text';
import type { CommandMarks, MarkedCommand, MarkSpot } from './command-marks';
import type { ReviewField, ReviewPosition } from './review-field';

/** Why command navigation cannot run: no command is marked, or a full-screen program has the screen (US-5.2.3). */
export type CommandUnavailable = { readonly kind: 'unavailable'; readonly reason: 'none' | 'full-screen' };

/** Where a move between commands ended (US-5.2.1). */
export type CommandMove =
    /** On a command, shown at the top of the terminal or under the review caret. */
    | {
          readonly kind: 'moved';
          /** The command's line: its prompt and what was typed. */
          readonly line: string;
          readonly exitCode: number | undefined;
          readonly running: boolean;
      }
    /** Nowhere: no command lies that way. */
    | { readonly kind: 'edge'; readonly direction: CommandDirection }
    | CommandUnavailable;

/** A command's output, as text (US-5.2.1). */
export type CommandOutput =
    { readonly kind: 'output'; readonly text: string; readonly lines: number } | CommandUnavailable;

/** Back to earlier commands, or on to later ones. */
export type CommandDirection = 'previous' | 'next';

/**
 * Moves between the commands shell integration marked, and reads and selects the last one's output (US-5.2.1), in
 * the terminal or, while it is open, in review mode. In the terminal, moves start from the prompt, and again after
 * the user types; in review mode, from the caret's line.
 */
export class CommandNavigator {
    readonly #terminal: Terminal;
    readonly #marks: CommandMarks;
    readonly #review: () => ReviewField | undefined;
    #current: MarkedCommand | undefined;

    /** A navigator over `terminal`'s marks, moving review mode's caret when `review` gives an open one. */
    constructor(terminal: Terminal, marks: CommandMarks, review: () => ReviewField | undefined) {
        this.#terminal = terminal;
        this.#marks = marks;
        this.#review = review;
    }

    /** Goes to the previous or the next command. */
    step(direction: CommandDirection): CommandMove {
        const commands = this.#marks.commands.filter((entry) => entry.bookmark || entry.output !== undefined);
        if (this.#terminal.buffer.active.type === 'alternate') {
            return { kind: 'unavailable', reason: 'full-screen' };
        }
        if (commands.length === 0) {
            return { kind: 'unavailable', reason: 'none' };
        }
        const review = this.#openReview();
        const target = pick(commands, this.#reference(review), direction);
        if (target === undefined) {
            return { kind: 'edge', direction };
        }
        const line = this.#show(target, review);
        return {
            kind: 'moved',
            line,
            exitCode: target.exitCode,
            running: !target.bookmark && target.end === undefined,
        };
    }

    /** Starts moves from the prompt again, as the user typed. */
    reset(): void {
        this.#current = undefined;
    }

    /** The last command's output, from the normal buffer, which a full-screen program leaves as it was. */
    lastOutput(): CommandOutput {
        const range = this.#lastRange();
        if (range === undefined) {
            return { kind: 'unavailable', reason: 'none' };
        }
        const text = textBetween(this.#terminal.buffer.normal, range.from, range.to);
        return { kind: 'output', text, lines: text === '' ? 0 : text.split('\n').length };
    }

    /** Selects the last command's output, in review mode while it is open, otherwise in the terminal (A11Y-04). */
    selectLastOutput(): CommandOutput {
        if (this.#terminal.buffer.active.type === 'alternate') {
            return { kind: 'unavailable', reason: 'full-screen' };
        }
        const output = this.lastOutput();
        const range = this.#lastRange();
        if (output.kind === 'unavailable' || range === undefined) {
            return output;
        }
        const review = this.#openReview();
        if (review === undefined) {
            this.#selectInTerminal(range.from, range.to);
        } else {
            const buffer = this.#terminal.buffer.active;
            review.selectLines(this.#reviewPosition(buffer, range.from), this.#reviewPosition(buffer, range.to));
        }
        return output;
    }

    #openReview(): ReviewField | undefined {
        const review = this.#review();
        return review?.isOpen === true ? review : undefined;
    }

    #reference(review: ReviewField | undefined): number {
        if (review === undefined) {
            return this.#current?.prompt.marker.line ?? Number.POSITIVE_INFINITY;
        }
        return bufferText(this.#terminal).firstRows[review.caretLine()] ?? Number.POSITIVE_INFINITY;
    }

    #show(target: MarkedCommand, review: ReviewField | undefined): string {
        const buffer = this.#terminal.buffer.active;
        const row = logicalStart(buffer, target.prompt.marker.line);
        const typed = logicalStart(buffer, target.input?.marker.line ?? row);
        const line = logicalLine(buffer, typed).text;
        if (review === undefined) {
            this.#current = target;
            this.#terminal.scrollToLine(row);
        } else {
            const index = bufferText(this.#terminal).firstRows.indexOf(typed);
            review.select(index, 0, line.length);
        }
        return line;
    }

    /**
     * The last command's output: the running one's so far, or while a full-screen program runs, which is the running
     * command, the last finished one's.
     */
    #lastRange(): { readonly from: BufferCell; readonly to: BufferCell } | undefined {
        const finishedOnly = this.#terminal.buffer.active.type === 'alternate';
        const last = this.#marks.commands.findLast(
            (entry) => entry.output !== undefined && (!finishedOnly || entry.end !== undefined),
        );
        if (last?.output === undefined) {
            return undefined;
        }
        const buffer = this.#terminal.buffer.normal;
        const from = cellOf(last.output);
        const to =
            last.end === undefined ? { row: buffer.baseY + buffer.cursorY, column: buffer.cursorX } : cellOf(last.end);
        return { from, to: endBefore(buffer, from, to) };
    }

    #selectInTerminal(from: BufferCell, to: BufferCell): void {
        const columns = this.#terminal.cols;
        const length = (to.row - from.row) * columns + to.column - from.column;
        if (length > 0) {
            this.#terminal.select(from.column, from.row, length);
        }
        this.#terminal.scrollToLine(from.row);
    }

    #reviewPosition(buffer: IBuffer, cell: BufferCell): ReviewPosition {
        const start = logicalStart(buffer, cell.row);
        const line = bufferText(this.#terminal).firstRows.indexOf(start);
        const column = new LogicalText(buffer, cell.row, this.#terminal.cols).offsetOf(cell) ?? 0;
        return { line, column };
    }
}

function pick(
    commands: readonly MarkedCommand[],
    reference: number,
    direction: CommandDirection,
): MarkedCommand | undefined {
    return direction === 'previous'
        ? commands.findLast((entry) => entry.prompt.marker.line < reference)
        : commands.find((entry) => entry.prompt.marker.line > reference);
}

function cellOf(spot: MarkSpot): BufferCell {
    return { row: spot.marker.line, column: spot.column };
}

/** `to`, or the end of the row above it when it is at a row's start, so a range never ends with a line break. */
function endBefore(buffer: IBuffer, from: BufferCell, to: BufferCell): BufferCell {
    if (to.column > 0 || to.row <= from.row) {
        return to;
    }
    const row = to.row - 1;
    return { row, column: buffer.getLine(row)?.length ?? 0 };
}

/** The text from `from` to `to`, soft-wrapped rows joined, trailing blanks of each line and of the whole trimmed. */
function textBetween(buffer: IBuffer, from: BufferCell, to: BufferCell): string {
    let text = '';
    for (let row = from.row; row <= to.row; row += 1) {
        const line = buffer.getLine(row);
        const start = row === from.row ? from.column : 0;
        const end = row === to.row ? to.column : undefined;
        const wrapsOn = row < to.row && buffer.getLine(row + 1)?.isWrapped === true;
        const part = line?.translateToString(!wrapsOn, start, end) ?? '';
        text += wrapsOn || row === to.row ? part : `${part.trimEnd()}\n`;
    }
    return text.trimEnd();
}
