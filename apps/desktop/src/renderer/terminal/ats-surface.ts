import type { Terminal } from '@xterm/xterm';
import { SelectionAutoScroll } from './selection-autoscroll';
import { type CellLine, columnToOffset, minimalEdit, offsetToColumn, rowsToRender } from './text-geometry';
import type { UpdateScheduler } from './update-scheduler';

/** The cell size the ATS rows are laid out with, in CSS pixels. */
export interface CellSize {
    readonly width: number;
    readonly height: number;
}

type DomPoint = readonly [Text, number];

/** How many selected lines the OS sees at most (A11Y-04.7, S3a). */
export const SELECTION_CAP = 5_000;

/**
 * The Accessible Text Surface's content: one text node per rendered row, the DOM selection mirrored with xterm's in
 * both directions, and a collapsed caret at the terminal cursor (A11Y-04, A11Y-06, S2 rules). A pointer selection
 * dragged past the top or bottom edge scrolls the terminal and grows with it.
 */
export class AtsSurface {
    readonly #terminal: Terminal;
    readonly #element: HTMLElement;
    readonly #rows = new Map<number, HTMLElement>();
    #cell: CellSize = { width: 0, height: 0 };
    #ownSelection: string | undefined;
    #pointerSelecting = false;

    /** Binds the surface element to a terminal. */
    constructor(terminal: Terminal, element: HTMLElement) {
        this.#terminal = terminal;
        this.#element = element;
    }

    /** Starts mirroring DOM selection changes into the terminal and tracking pointer drags. */
    listen(scheduler: UpdateScheduler): () => void {
        const autoScroll = new SelectionAutoScroll({
            bounds: () => this.#element.getBoundingClientRect(),
            rowHeight: () => this.#cell.height,
            scrollSelection: (lines, clientX) => this.#scrollSelection(lines, clientX),
        });
        const onSelection = (): void => this.#onDomSelection();
        const onPointerDown = (event: PointerEvent): void => {
            if (event.button === 0) {
                this.#pointerSelecting = true;
            }
        };
        const onPointerMove = (event: PointerEvent): void => {
            if (this.#pointerSelecting) {
                autoScroll.move(event.clientX, event.clientY);
            }
        };
        const onPointerUp = (): void => {
            autoScroll.stop();
            if (this.#pointerSelecting) {
                this.#pointerSelecting = false;
                scheduler.request();
            }
        };
        document.addEventListener('selectionchange', onSelection);
        this.#element.addEventListener('pointerdown', onPointerDown);
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        return () => {
            autoScroll.stop();
            document.removeEventListener('selectionchange', onSelection);
            this.#element.removeEventListener('pointerdown', onPointerDown);
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
        };
    }

    /** Sets the cell size the rows are positioned with. */
    setCellSize(cell: CellSize): void {
        this.#cell = cell;
        this.#element.style.lineHeight = `${cell.height}px`;
    }

    /** Brings the rows, the selection and the caret up to date with the terminal. */
    update(): void {
        const buffer = this.#terminal.buffer.active;
        const cursorRow = buffer.baseY + buffer.cursorY;
        const wanted = rowsToRender({
            viewportY: buffer.viewportY,
            rows: this.#terminal.rows,
            selection: this.#selectedRows(),
            cap: SELECTION_CAP,
        });
        this.#removeRowsExcept(new Set(wanted));
        let previous: HTMLElement | undefined;
        for (const row of wanted) {
            const node = this.#rowNode(row);
            this.#setRowText(node, this.#rowText(row, row === cursorRow ? buffer.cursorX : undefined));
            node.style.top = `${(row - buffer.viewportY) * this.#cell.height}px`;
            const expected = previous === undefined ? this.#element.firstChild : previous.nextSibling;
            if (expected !== node) {
                this.#element.insertBefore(node, expected);
            }
            previous = node;
        }
        this.syncSelection();
    }

    /** Writes the terminal's selection into the DOM, or the caret at the cursor, unless the DOM leads right now. */
    syncSelection(): void {
        if (document.activeElement !== this.#element || this.#pointerSelecting) {
            return;
        }
        const position = this.#terminal.getSelectionPosition();
        if (position !== undefined) {
            const endRow = Math.min(position.end.y, position.start.y + SELECTION_CAP - 1);
            const start = this.#domPoint(position.start.y, position.start.x);
            const end = this.#domPoint(endRow, position.end.x);
            if (start !== undefined && end !== undefined) {
                this.#setDomSelection(start, end);
            }
            return;
        }
        const current = getSelection();
        if (current !== null && !current.isCollapsed && this.#element.contains(current.anchorNode)) {
            return;
        }
        this.placeCaret();
    }

    /** Collapses the DOM selection at the terminal cursor in one change. */
    placeCaret(): void {
        const buffer = this.#terminal.buffer.active;
        const caret = this.#domPoint(buffer.baseY + buffer.cursorY, buffer.cursorX);
        if (caret !== undefined) {
            this.#setDomSelection(caret, caret);
        }
    }

    /** Rebuilds every row node, after an IME composition may have changed the DOM. */
    resetRows(): void {
        for (const node of this.#rows.values()) {
            node.replaceChildren(document.createTextNode(''));
        }
    }

    #scrollSelection(lines: number, clientX: number): void {
        this.#terminal.scrollLines(lines);
        this.update();
        const { viewportY } = this.#terminal.buffer.active;
        const row = lines > 0 ? viewportY + this.#terminal.rows - 1 : viewportY;
        const column = Math.floor(
            (clientX - this.#element.getBoundingClientRect().left) / Math.max(1, this.#cell.width),
        );
        const point = this.#domPoint(row, Math.max(0, Math.min(column, this.#terminal.cols)));
        const selection = getSelection();
        if (point !== undefined && selection?.anchorNode && this.#element.contains(selection.anchorNode)) {
            selection.extend(point[0], point[1]);
            this.#mirrorRange(selection.getRangeAt(0));
        }
    }

    #selectedRows(): { startRow: number; endRow: number } | undefined {
        const position = this.#terminal.getSelectionPosition();
        return position === undefined ? undefined : { startRow: position.start.y, endRow: position.end.y };
    }

    #removeRowsExcept(wanted: ReadonlySet<number>): void {
        for (const [row, node] of this.#rows) {
            if (!wanted.has(row)) {
                node.remove();
                this.#rows.delete(row);
            }
        }
    }

    #rowNode(row: number): HTMLElement {
        const existing = this.#rows.get(row);
        if (existing !== undefined) {
            return existing;
        }
        const node = document.createElement('div');
        node.className = 'ats-row';
        node.dataset['row'] = String(row);
        node.append(document.createTextNode(''));
        this.#rows.set(row, node);
        return node;
    }

    #setRowText(node: HTMLElement, text: string): void {
        if (node.childNodes.length !== 1 || !(node.firstChild instanceof Text)) {
            node.replaceChildren(document.createTextNode(''));
        }
        const textNode = node.firstChild as Text;
        if (textNode.data !== text) {
            const edit = minimalEdit(textNode.data, text);
            textNode.replaceData(edit.start, edit.deleteCount, edit.insert);
        }
    }

    #rowText(row: number, padToColumn: number | undefined): string {
        const line = this.#terminal.buffer.active.getLine(row);
        if (line === undefined) {
            return '';
        }
        const text = line.translateToString(true);
        if (padToColumn === undefined) {
            return text;
        }
        return text.padEnd(columnToOffset(this.#cells(row), padToColumn, this.#terminal.cols), ' ');
    }

    #cells(row: number): CellLine {
        const line = this.#terminal.buffer.active.getLine(row);
        return {
            cell: (column) => {
                const cell = line?.getCell(column);
                return cell === undefined ? undefined : { chars: cell.getChars(), width: cell.getWidth() };
            },
        };
    }

    #domPoint(row: number, column: number): DomPoint | undefined {
        const text = this.#rows.get(row)?.firstChild;
        if (!(text instanceof Text)) {
            return undefined;
        }
        return [text, Math.min(columnToOffset(this.#cells(row), column, this.#terminal.cols), text.data.length)];
    }

    #setDomSelection(anchor: DomPoint, focus: DomPoint): void {
        const selection = getSelection();
        if (selection === null) {
            return;
        }
        const same =
            selection.anchorNode === anchor[0] &&
            selection.anchorOffset === anchor[1] &&
            selection.focusNode === focus[0] &&
            selection.focusOffset === focus[1];
        if (!same) {
            this.#ownSelection = selectionKey(anchor[0], anchor[1], focus[0], focus[1]);
            selection.setBaseAndExtent(anchor[0], anchor[1], focus[0], focus[1]);
        }
    }

    #onDomSelection(): void {
        const selection = getSelection();
        if (selection === null || selection.anchorNode === null || !this.#element.contains(selection.anchorNode)) {
            return;
        }
        const key = selectionKey(
            selection.anchorNode,
            selection.anchorOffset,
            selection.focusNode,
            selection.focusOffset,
        );
        if (key === this.#ownSelection) {
            return;
        }
        this.#ownSelection = undefined;
        if (selection.isCollapsed) {
            this.#terminal.clearSelection();
            return;
        }
        this.#mirrorRange(selection.getRangeAt(0));
    }

    #mirrorRange(range: Range): void {
        const startRow = rowOf(range.startContainer);
        const endRow = rowOf(range.endContainer);
        if (startRow === undefined || endRow === undefined) {
            return;
        }
        const columns = this.#terminal.cols;
        const startColumn = offsetToColumn(this.#cells(startRow), range.startOffset, columns);
        const endColumn = offsetToColumn(this.#cells(endRow), range.endOffset, columns);
        this.#terminal.select(startColumn, startRow, (endRow - startRow) * columns + endColumn - startColumn);
    }
}

function rowOf(node: Node | null): number | undefined {
    const row = node?.parentElement?.dataset['row'];
    return row === undefined ? undefined : Number(row);
}

function selectionKey(anchor: Node | null, anchorOffset: number, focus: Node | null, focusOffset: number): string {
    return `${rowOf(anchor)}:${anchorOffset}/${rowOf(focus)}:${focusOffset}`;
}
