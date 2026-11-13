/** A terminal cell in CSS pixels. */
export interface CellSize {
    readonly width: number;
    readonly height: number;
}

/** The space a terminal may fill, and how it may fill it. */
export interface GridSpace {
    readonly width: number;
    readonly height: number;
    readonly cell: CellSize;
    /** The width xterm keeps for its scrollbar. */
    readonly scrollbar: number;
    readonly maxColumns: number;
}

/** A grid size, and the CSS width that holds it with its scrollbar. */
export interface GridFit {
    readonly cols: number;
    readonly rows: number;
    readonly width: number;
}

const MIN_COLUMNS = 2;
const MIN_ROWS = 1;

/**
 * The largest grid that fits the space, with at most `maxColumns` columns. A narrow window or a zoom drops columns
 * instead of clipping them (A11Y-07.4, A11Y-07.5). Returns `undefined` until the cell has been measured.
 */
export function fitGrid(space: GridSpace): GridFit | undefined {
    const { cell } = space;
    if (cell.width <= 0 || cell.height <= 0) {
        return undefined;
    }
    const available = Math.floor((space.width - space.scrollbar) / cell.width);
    const cols = Math.max(MIN_COLUMNS, Math.min(space.maxColumns, available));
    const rows = Math.max(MIN_ROWS, Math.floor(space.height / cell.height));
    return { cols, rows, width: cols * cell.width + space.scrollbar };
}

/**
 * The letter spacing, in device pixels, that xterm.js must add to its cells. It floors the glyph advance to device
 * pixels, so a font whose advance is fractional there gets cells narrower than its glyphs, which cuts them.
 */
export function glyphSpacing(advance: number, pixelRatio: number): number {
    const device = advance * pixelRatio;
    return Math.ceil(device) - Math.floor(device);
}
