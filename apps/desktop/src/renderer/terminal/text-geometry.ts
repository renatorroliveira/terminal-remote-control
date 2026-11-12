/** One buffer cell as the ATS reads it. */
export interface Cell {
    /** The cell's characters; empty for a blank cell. */
    readonly chars: string;
    /** 1 or 2 columns; 0 for the trailing half of a wide character. */
    readonly width: number;
}

/** A buffer line, cell by cell. */
export interface CellLine {
    cell(column: number): Cell | undefined;
}

/** A replacement that turns one string into another while keeping their common prefix and suffix. */
export interface TextEdit {
    readonly start: number;
    readonly deleteCount: number;
    readonly insert: string;
}

/** The selected buffer rows. */
export interface SelectedRows {
    readonly startRow: number;
    readonly endRow: number;
}

/** What the ATS renders: the viewport, plus every selected row up to the cap (A11Y-04.7, D-08). */
export interface RenderWindow {
    readonly viewportY: number;
    readonly rows: number;
    readonly selection: SelectedRows | undefined;
    readonly cap: number;
}

/** The text offset of a grid column in a row's text, skipping the trailing halves of wide characters. */
export function columnToOffset(line: CellLine, column: number, columns: number): number {
    let offset = 0;
    for (let x = 0; x < Math.min(column, columns); x += 1) {
        offset += textLength(line.cell(x));
    }
    return offset;
}

/** The grid column at a text offset in a row's text. */
export function offsetToColumn(line: CellLine, offset: number, columns: number): number {
    let consumed = 0;
    for (let x = 0; x < columns; x += 1) {
        const length = textLength(line.cell(x));
        if (length > 0 && consumed >= offset) {
            return x;
        }
        consumed += length;
    }
    return columns;
}

/** The smallest replacement from `previous` to `next`, so a caret outside the change keeps its offset. */
export function minimalEdit(previous: string, next: string): TextEdit {
    const limit = Math.min(previous.length, next.length);
    let start = 0;
    while (start < limit && previous[start] === next[start]) {
        start += 1;
    }
    let end = 0;
    while (
        end < previous.length - start &&
        end < next.length - start &&
        previous[previous.length - 1 - end] === next[next.length - 1 - end]
    ) {
        end += 1;
    }
    return { start, deleteCount: previous.length - start - end, insert: next.slice(start, next.length - end) };
}

/** The rows the ATS renders, in buffer order. */
export function rowsToRender(window: RenderWindow): number[] {
    const rows = new Set<number>();
    for (let y = 0; y < window.rows; y += 1) {
        rows.add(window.viewportY + y);
    }
    if (window.selection !== undefined) {
        const last = Math.min(window.selection.endRow, window.selection.startRow + window.cap - 1);
        for (let y = window.selection.startRow; y <= last; y += 1) {
            rows.add(y);
        }
    }
    return [...rows].sort((left, right) => left - right);
}

function textLength(cell: Cell | undefined): number {
    if (cell === undefined || cell.width === 0) {
        return 0;
    }
    return cell.chars.length > 0 ? cell.chars.length : 1;
}
