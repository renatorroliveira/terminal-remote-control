import type { Terminal } from '@xterm/xterm';
import type { AtsSurface } from './ats-surface';
import { type CellSize, fitGrid, type GridFit, glyphSpacing } from './grid-fit';

/** The elements a terminal's size and alignment depend on. */
export interface GeometryElements {
    /** The space the terminal may fill. */
    readonly frame: HTMLElement;
    /** The box sized to the grid and centered in the frame. */
    readonly host: HTMLElement;
    readonly surface: HTMLElement;
    /** A hidden run of glyphs in the surface's font, for the glyph advance. */
    readonly measurer: HTMLElement;
}

/** The width xterm keeps for its scrollbar, in CSS pixels. */
export const SCROLLBAR_WIDTH = 14;

const MEASURE_GLYPHS = 64;

/**
 * Fits the grid to its frame, at most `maxColumns` wide and centered, and keeps the Accessible Text Surface on the
 * grid: row height equals the cell height, and letter spacing makes every glyph advance exactly one cell, so the
 * caret and the selection sit on the cells they stand for (A11Y-04.5, A11Y-06.3, A11Y-07.4).
 */
export class TerminalGeometry {
    readonly #terminal: Terminal;
    readonly #elements: GeometryElements;
    readonly #ats: AtsSurface;
    readonly #maxColumns: number;
    #observer: ResizeObserver | undefined;
    #fitted: () => void = () => undefined;
    #extraSpacing = 0;

    /** Binds the geometry to a terminal and its elements. */
    constructor(terminal: Terminal, elements: GeometryElements, ats: AtsSurface, maxColumns: number) {
        this.#terminal = terminal;
        this.#elements = elements;
        this.#ats = ats;
        this.#maxColumns = maxColumns;
        elements.measurer.textContent = 'W'.repeat(MEASURE_GLYPHS);
    }

    /**
     * Fits now and whenever the frame or the rendered grid changes size; the renderer sizes the grid only after its
     * first frame. Resolves after the first fit.
     */
    observe(): Promise<void> {
        const fitted = new Promise<void>((resolve) => {
            this.#fitted = resolve;
        });
        this.#observer = new ResizeObserver(() => this.fit());
        this.#observer.observe(this.#elements.frame);
        const screen = this.#terminal.element?.querySelector('.xterm-screen');
        if (screen !== null && screen !== undefined) {
            this.#observer.observe(screen);
        }
        this.fit();
        return fitted;
    }

    /** Adds space between columns, in CSS pixels, on top of the spacing that aligns glyphs to device pixels. */
    setExtraSpacing(spacing: number): void {
        this.#extraSpacing = spacing;
        this.fit();
    }

    /** Resizes the grid to the frame, then realigns the surface. */
    fit(): void {
        const spacing = glyphSpacing(this.#advance(), window.devicePixelRatio) + this.#extraSpacing;
        if (this.#terminal.options.letterSpacing !== spacing) {
            this.#terminal.options.letterSpacing = spacing;
        }
        const grid = this.#grid();
        if (grid === undefined) {
            return;
        }
        this.#elements.host.style.width = `${grid.width + padding(this.#elements.host).width}px`;
        if (grid.cols !== this.#terminal.cols || grid.rows !== this.#terminal.rows) {
            this.#terminal.resize(grid.cols, grid.rows);
        }
        this.align();
        this.#fitted();
    }

    /** Matches the surface's rows and glyph advance to the rendered cells. */
    align(): void {
        const cell = this.#cell();
        if (cell === undefined) {
            return;
        }
        const { surface } = this.#elements;
        surface.dataset['columns'] = String(this.#terminal.cols);
        surface.dataset['rows'] = String(this.#terminal.rows);
        surface.style.width = `${cell.width * this.#terminal.cols}px`;
        surface.style.letterSpacing = `${cell.width - this.#advance()}px`;
        this.#ats.setCellSize(cell);
    }

    /** Stops observing the frame. */
    dispose(): void {
        this.#observer?.disconnect();
        this.#fitted();
    }

    #advance(): number {
        return this.#elements.measurer.getBoundingClientRect().width / MEASURE_GLYPHS;
    }

    #grid(): GridFit | undefined {
        const cell = this.#cell();
        const frame = contentBox(this.#elements.frame);
        const inner = padding(this.#elements.host);
        const space = { width: frame.width - inner.width, height: frame.height - inner.height };
        if (cell === undefined || space.width <= 0 || space.height <= 0) {
            return undefined;
        }
        return fitGrid({
            width: space.width,
            height: space.height,
            cell,
            scrollbar: SCROLLBAR_WIDTH,
            maxColumns: this.#maxColumns,
        });
    }

    #cell(): CellSize | undefined {
        const screen = this.#terminal.element?.querySelector('.xterm-screen')?.getBoundingClientRect();
        if (screen === undefined || screen.width === 0 || screen.height === 0) {
            return undefined;
        }
        return { width: screen.width / this.#terminal.cols, height: screen.height / this.#terminal.rows };
    }
}

interface Size {
    readonly width: number;
    readonly height: number;
}

function contentBox(element: HTMLElement): Size {
    const inner = padding(element);
    return { width: element.clientWidth - inner.width, height: element.clientHeight - inner.height };
}

function padding(element: HTMLElement): Size {
    const style = getComputedStyle(element);
    return {
        width: Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight),
        height: Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom),
    };
}
