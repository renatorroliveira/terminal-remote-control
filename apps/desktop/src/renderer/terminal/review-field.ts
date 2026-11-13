import type { BufferText } from './buffer-text';
import styles from './terminal-view.module.css';

/** How many logical lines review mode holds at once (A11Y-03.2, S3a). */
export const REVIEW_PAGE_LINES = 500;
/** How close to a page edge the caret gets before the next page loads. */
const EDGE_LINES = 50;

/** What review mode reports. */
export interface ReviewFieldOptions {
    /** The user pressed Escape. */
    readonly onClose: () => void;
    /** Output arrived while review mode was open: once, until the user goes to the end (A11Y-03.5). */
    readonly onNewOutput: () => void;
}

interface Position {
    readonly line: number;
    readonly column: number;
}

/**
 * Review mode (A11Y-03): the scrollback and screen as a read-only, multi-line text field that screen readers, braille
 * displays and the keyboard read with their usual text commands. It holds a page of logical lines around the caret
 * and loads the next page as the caret nears an edge; Command+Up and Command+Down (Control+Home and End) reach the
 * start and the end of the whole buffer. Output that arrives while it is open never moves it.
 */
export class ReviewField {
    /** The text field. */
    readonly element: HTMLTextAreaElement;
    readonly #host: HTMLElement;
    readonly #read: () => BufferText;
    readonly #options: ReviewFieldOptions;
    readonly #cleanups: (() => void)[] = [];
    #lines: readonly string[] = [];
    #start = 0;
    #offsets: readonly number[] = [];
    #noticed = false;

    /** A review field for `host`, reading the buffer with `read`. */
    constructor(host: HTMLElement, read: () => BufferText, options: ReviewFieldOptions) {
        this.#host = host;
        this.#read = read;
        this.#options = options;
        this.element = createField();
    }

    /** Whether review mode is open. */
    get isOpen(): boolean {
        return this.element.isConnected;
    }

    /** Opens review mode named `label`, with the caret on the line that holds the terminal cursor (A11Y-03.3). */
    open(label: string): void {
        const text = this.#read();
        this.#lines = text.lines;
        this.#noticed = false;
        this.element.setAttribute('aria-label', label);
        this.#host.append(this.element);
        this.#listen();
        this.#showAround({ line: text.cursorLine, column: 0 }, { line: text.cursorLine, column: 0 });
        this.element.focus();
    }

    /** Closes review mode. */
    close(): void {
        for (const cleanup of this.#cleanups.splice(0)) {
            cleanup();
        }
        this.element.remove();
    }

    /** Moves keyboard focus to the field. */
    focus(): void {
        this.element.focus();
    }

    /** Records output that arrived: a notice once, until the user goes to the end (A11Y-03.5). */
    output(): void {
        if (this.isOpen && !this.#noticed) {
            this.#noticed = true;
            this.#options.onNewOutput();
        }
    }

    /** Selects columns `start` to `end` of a line, loading its page, as find does (A11Y-03.6). */
    select(line: number, start: number, end: number): void {
        this.#lines = this.#read().lines;
        this.#showAround({ line, column: start }, { line, column: end });
    }

    #listen(): void {
        const onKey = (event: KeyboardEvent): void => this.#key(event);
        const onMove = (): void => this.#caretMoved();
        const events = ['select', 'selectionchange', 'keyup', 'mouseup'] as const;
        this.element.addEventListener('keydown', onKey);
        for (const type of events) {
            this.element.addEventListener(type, onMove);
        }
        this.#cleanups.push(() => {
            this.element.removeEventListener('keydown', onKey);
            for (const type of events) {
                this.element.removeEventListener(type, onMove);
            }
        });
    }

    #key(event: KeyboardEvent): void {
        const toStart = (event.metaKey && event.key === 'ArrowUp') || (event.ctrlKey && event.key === 'Home');
        const toEnd = (event.metaKey && event.key === 'ArrowDown') || (event.ctrlKey && event.key === 'End');
        if (event.key === 'Escape') {
            event.preventDefault();
            this.#options.onClose();
        } else if (toStart) {
            event.preventDefault();
            this.#lines = this.#read().lines;
            this.#showAround({ line: 0, column: 0 }, { line: 0, column: 0 });
        } else if (toEnd) {
            event.preventDefault();
            this.#toEnd();
        }
    }

    #toEnd(): void {
        this.#lines = this.#read().lines;
        this.#noticed = false;
        const line = Math.max(0, this.#lines.length - 1);
        const column = this.#lines[line]?.length ?? 0;
        this.#showAround({ line, column }, { line, column });
    }

    #caretMoved(): void {
        const caret = this.#position(this.element.selectionStart);
        const end = this.#start + this.#offsets.length;
        const nearTop = caret.line - this.#start < EDGE_LINES && this.#start > 0;
        const nearBottom = end - caret.line <= EDGE_LINES && end < this.#lines.length;
        if (!nearTop && !nearBottom) {
            return;
        }
        const anchor = this.#position(this.element.selectionStart);
        const focus = this.#position(this.element.selectionEnd);
        const direction = this.element.selectionDirection;
        this.#page(pageStart(caret.line, this.#lines.length));
        this.element.setSelectionRange(this.#offset(anchor), this.#offset(focus), direction);
    }

    #showAround(anchor: Position, focus: Position): void {
        this.#page(pageStart(anchor.line, this.#lines.length));
        this.element.setSelectionRange(this.#offset(anchor), this.#offset(focus));
    }

    #page(start: number): void {
        this.#start = start;
        const page = this.#lines.slice(start, start + REVIEW_PAGE_LINES);
        const offsets: number[] = [];
        let offset = 0;
        for (const line of page) {
            offsets.push(offset);
            offset += line.length + 1;
        }
        this.#offsets = offsets;
        this.element.value = page.join('\n');
    }

    #offset(position: Position): number {
        const index = Math.min(Math.max(0, position.line - this.#start), this.#offsets.length - 1);
        const length = this.#lines[this.#start + index]?.length ?? 0;
        return (this.#offsets[index] ?? 0) + Math.min(position.column, length);
    }

    #position(offset: number): Position {
        let index = 0;
        while (index + 1 < this.#offsets.length && (this.#offsets[index + 1] ?? 0) <= offset) {
            index += 1;
        }
        return { line: this.#start + index, column: offset - (this.#offsets[index] ?? 0) };
    }
}

function pageStart(line: number, total: number): number {
    const centered = line - Math.floor(REVIEW_PAGE_LINES / 2);
    return Math.max(0, Math.min(centered, total - REVIEW_PAGE_LINES));
}

function createField(): HTMLTextAreaElement {
    const field = document.createElement('textarea');
    field.readOnly = true;
    field.dataset['review'] = '';
    field.spellcheck = false;
    field.className = styles['review'] ?? '';
    field.setAttribute('autocapitalize', 'off');
    field.setAttribute('autocorrect', 'off');
    return field;
}
