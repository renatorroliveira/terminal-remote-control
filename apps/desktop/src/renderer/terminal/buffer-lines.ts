import type { IBuffer } from '@xterm/xterm';
import { type CellLine, columnToOffset, offsetToColumn } from './text-geometry';

/** A buffer position: an absolute row and a column. */
export interface BufferCell {
    readonly row: number;
    readonly column: number;
}

/** The first row of the logical line holding `row`: soft-wrapped rows belong to the row above. */
export function logicalStart(buffer: IBuffer, row: number): number {
    let start = row;
    while (start > 0 && buffer.getLine(start)?.isWrapped === true) {
        start -= 1;
    }
    return start;
}

/** The row after the logical line that starts at `start`. */
export function logicalEnd(buffer: IBuffer, start: number): number {
    let next = start + 1;
    while (next < buffer.length && buffer.getLine(next)?.isWrapped === true) {
        next += 1;
    }
    return next;
}

/** The text of the logical line that starts at `start`, trailing blanks trimmed, and the row after it. */
export function logicalLine(buffer: IBuffer, start: number): { readonly text: string; readonly next: number } {
    const next = logicalEnd(buffer, start);
    let text = '';
    for (let row = start; row < next; row += 1) {
        text += buffer.getLine(row)?.translateToString(row === next - 1) ?? '';
    }
    return { text: text.trimEnd(), next };
}

/** A buffer row, cell by cell, as the text geometry reads it. */
export function cellLine(buffer: IBuffer, row: number): CellLine {
    const line = buffer.getLine(row);
    return {
        cell: (column) => {
            const cell = line?.getCell(column);
            return cell === undefined ? undefined : { chars: cell.getChars(), width: cell.getWidth() };
        },
    };
}

/** A logical line's text with the way back and forth between its text offsets and its cells. */
export class LogicalText {
    /** The line's text, soft-wrapped rows joined. */
    readonly text: string;
    readonly #buffer: IBuffer;
    readonly #columns: number;
    readonly #rows: readonly { readonly row: number; readonly offset: number }[];

    /** The logical line holding `row`. */
    constructor(buffer: IBuffer, row: number, columns: number) {
        this.#buffer = buffer;
        this.#columns = columns;
        const start = logicalStart(buffer, row);
        const next = logicalEnd(buffer, start);
        const rows: { row: number; offset: number }[] = [];
        let text = '';
        for (let current = start; current < next; current += 1) {
            rows.push({ row: current, offset: text.length });
            text += buffer.getLine(current)?.translateToString(current === next - 1) ?? '';
        }
        this.text = text;
        this.#rows = rows;
    }

    /** The text offset of a cell, or undefined when the cell is not on this line. */
    offsetOf(cell: BufferCell): number | undefined {
        const entry = this.#rows.find((candidate) => candidate.row === cell.row);
        return entry === undefined
            ? undefined
            : entry.offset + columnToOffset(cellLine(this.#buffer, cell.row), cell.column, this.#columns);
    }

    /** The cell that holds the character at a text offset. */
    cellOf(offset: number): BufferCell {
        const entry = [...this.#rows].reverse().find((candidate) => candidate.offset <= offset) ?? this.#rows[0];
        const row = entry?.row ?? 0;
        const column = offsetToColumn(cellLine(this.#buffer, row), offset - (entry?.offset ?? 0), this.#columns);
        return { row, column };
    }
}
