import type { Terminal } from '@xterm/xterm';
import { logicalEnd, logicalLine, logicalStart } from './buffer-lines';

/** The active buffer as logical lines (A11Y-03.4). */
export interface BufferText {
    /** Each logical line, soft-wrapped rows joined and trailing blanks trimmed. */
    readonly lines: readonly string[];
    /** The buffer row each line starts on. */
    readonly firstRows: readonly number[];
    /** The line that holds the terminal cursor (A11Y-03.3). */
    readonly cursorLine: number;
}

/** Reads the active buffer, scrollback and screen, as logical lines. */
export function bufferText(terminal: Terminal): BufferText {
    const buffer = terminal.buffer.active;
    const cursorRow = logicalStart(buffer, buffer.baseY + buffer.cursorY);
    const lines: string[] = [];
    const firstRows: number[] = [];
    let cursorLine = 0;
    for (let row = 0; row < buffer.length; row = logicalEnd(buffer, row)) {
        if (row === cursorRow) {
            cursorLine = lines.length;
        }
        firstRows.push(row);
        lines.push(logicalLine(buffer, row).text);
    }
    return { lines, firstRows, cursorLine };
}
