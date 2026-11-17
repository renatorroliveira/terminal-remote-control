import type { Terminal } from '@xterm/xterm';
import { describe, expect, it, onTestFinished } from 'vitest';
import type { AtsSurface } from './ats-surface';
import { TerminalGeometry } from './terminal-geometry';

const CELL = { width: 10, height: 20 } as const;

/**
 * A terminal whose renderer draws a resize at once, as a visible one does, or only once it is drawn again, as
 * xterm.js does while the terminal is out of view: its screen keeps the old grid's size meanwhile.
 */
class FakeTerminal {
    readonly element = document.createElement('div');
    readonly options: { letterSpacing: number } = { letterSpacing: 0 };
    readonly resizes: { cols: number; rows: number }[] = [];
    cols = 80;
    rows = 20;
    paused = false;
    readonly #screen = document.createElement('div');

    constructor() {
        this.#screen.className = 'xterm-screen';
        this.element.append(this.#screen);
        this.#draw();
    }

    resize(cols: number, rows: number): void {
        this.cols = cols;
        this.rows = rows;
        this.resizes.push({ cols, rows });
        if (!this.paused) {
            this.#draw();
        }
    }

    /** Draws the grid it holds, as the renderer does once the terminal is in view again. */
    resume(): void {
        this.paused = false;
        this.#draw();
    }

    #draw(): void {
        this.#screen.style.width = `${this.cols * CELL.width}px`;
        this.#screen.style.height = `${this.rows * CELL.height}px`;
    }
}

function setup(height: number) {
    const frame = document.createElement('div');
    frame.style.cssText = `width: 1000px; height: ${height}px; position: absolute;`;
    const host = document.createElement('div');
    const surface = document.createElement('div');
    const measurer = document.createElement('span');
    const terminal = new FakeTerminal();
    host.append(terminal.element);
    frame.append(host, surface, measurer);
    document.body.append(frame);
    onTestFinished(() => frame.remove());
    const ats = { setCellSize: () => undefined } as unknown as AtsSurface;
    const geometry = new TerminalGeometry(terminal as unknown as Terminal, { frame, host, surface, measurer }, ats, {
        maxColumns: 80,
        onFit: () => undefined,
    });
    return { terminal, geometry, frame };
}

describe('TerminalGeometry: a renderer that has not drawn a resize yet', () => {
    it('keeps the cell size it measured, so fitting again never grows the grid past the frame', () => {
        const { terminal, geometry, frame } = setup(400);
        geometry.fit();
        expect(terminal.rows).toBe(20);
        terminal.paused = true;
        frame.style.height = '800px';
        for (let fit = 0; fit < 5; fit += 1) {
            geometry.fit();
        }
        expect(terminal.rows).toBe(40);
        terminal.resume();
        geometry.fit();
        expect(terminal.rows).toBe(40);
        expect(Math.max(...terminal.resizes.map((size) => size.rows))).toBe(40);
    });
});
