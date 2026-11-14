import type { IBuffer, IDisposable, ILink, IMarker, Terminal } from '@xterm/xterm';
import { MAX_LINK_LENGTH } from '../../shared/links';
import { hasBidiControls, stripBidiControls, stripControlCharacters } from '../../shared/text';
import { type BufferCell, LogicalText, logicalEnd, logicalStart } from './buffer-lines';
import { detectLinks } from './link-detector';

/** A link in the terminal: the text it shows and the target it opens (US-1.12.3). */
export interface TerminalLink {
    readonly text: string;
    readonly target: string;
}

/** Whether a click carries the modifier that opens links: Command on macOS, Control elsewhere. */
export type LinkModifier = (event: MouseEvent) => boolean;

interface Anchor {
    readonly marker: IMarker | undefined;
    readonly row: number;
    readonly column: number;
}

interface Hyperlink {
    readonly target: string;
    readonly start: Anchor;
    readonly end: Anchor;
}

const MOST_HYPERLINKS = 500;
const COMMAND_CLICK: LinkModifier = (event) => event.metaKey;

/**
 * The links in a terminal: OSC 8 hyperlinks, tracked as programs print them, and URLs detected in the text. It
 * finds the link under a cell for a modifier+click on the Accessible Text Surface, lists the links on the screen,
 * and lets xterm.js open them with the same modifier while a program takes the mouse.
 */
export class TerminalLinks {
    readonly #terminal: Terminal;
    readonly #disposables: readonly IDisposable[];
    #normal: Hyperlink[] = [];
    #alternate: Hyperlink[] = [];
    #open: { readonly target: string; readonly start: Anchor } | undefined;

    /** Tracks `terminal`'s links; `onActivate` opens one that xterm.js activated with `modifier`. */
    constructor(terminal: Terminal, onActivate: (link: TerminalLink) => void, modifier: LinkModifier = COMMAND_CLICK) {
        this.#terminal = terminal;
        terminal.options.linkHandler = {
            activate: (event, target) =>
                modifier(event) && usableTarget(target) && onActivate({ text: target, target }),
            allowNonHttpProtocols: true,
        };
        this.#disposables = [
            terminal.parser.registerOscHandler(8, (data) => this.#hyperlink(data)),
            terminal.buffer.onBufferChange(() => this.#forget(this.#alternate.splice(0))),
            terminal.registerLinkProvider({
                provideLinks: (line, callback) => callback(this.#providedLinks(line - 1, modifier, onActivate)),
            }),
        ];
    }

    /** The link under a cell of the active buffer, a hyperlink before a detected URL. */
    linkAt(row: number, column: number): TerminalLink | undefined {
        const cell = { row, column };
        const hyperlink = [...this.#active()].reverse().find((link) => this.#contains(link, cell));
        if (hyperlink !== undefined) {
            return { text: this.#text(hyperlink), target: hyperlink.target };
        }
        const line = new LogicalText(this.#terminal.buffer.active, row, this.#terminal.cols);
        const offset = line.offsetOf(cell);
        const found = detectLinks(line.text).find(
            (link) => offset !== undefined && link.start <= offset && offset < link.end,
        );
        return found === undefined ? undefined : { text: found.target, target: found.target };
    }

    /** The links on the screen, each once: hyperlinks, then detected URLs, top to bottom. */
    visible(): readonly TerminalLink[] {
        const buffer = this.#terminal.buffer.active;
        const first = buffer.viewportY;
        const last = first + this.#terminal.rows - 1;
        const hyperlinks = this.#active()
            .filter((link) => this.#row(link.end) >= first && this.#row(link.start) <= last)
            .map((link) => ({ text: this.#text(link), target: link.target }));
        const detected: TerminalLink[] = [];
        for (let row = logicalStart(buffer, first); row <= last; row = logicalEnd(buffer, row)) {
            const line = new LogicalText(buffer, row, this.#terminal.cols);
            detected.push(...detectLinks(line.text).map((link) => ({ text: link.target, target: link.target })));
        }
        return unique([...hyperlinks, ...detected]);
    }

    /** Stops tracking links. */
    dispose(): void {
        this.#forget(this.#normal.splice(0));
        this.#forget(this.#alternate.splice(0));
        this.#open?.start.marker?.dispose();
        for (const disposable of this.#disposables) {
            disposable.dispose();
        }
    }

    #hyperlink(data: string): boolean {
        const separator = data.indexOf(';');
        const target = separator < 0 ? '' : data.slice(separator + 1);
        const open = this.#open;
        this.#open = undefined;
        if (open !== undefined) {
            this.#record({ ...open, end: this.#anchor() });
        }
        if (usableTarget(target)) {
            this.#open = { target, start: this.#anchor() };
        }
        return false;
    }

    #record(link: Hyperlink): void {
        const list = this.#terminal.buffer.active.type === 'alternate' ? this.#alternate : this.#normal;
        if (this.#position(link.end) <= this.#position(link.start)) {
            this.#forget([link]);
            return;
        }
        list.push(link);
        this.#forget(list.splice(0, Math.max(0, list.length - MOST_HYPERLINKS)));
    }

    #anchor(): Anchor {
        const buffer = this.#terminal.buffer.active;
        const marker = buffer.type === 'normal' ? this.#terminal.registerMarker(0) : undefined;
        return { marker, row: buffer.baseY + buffer.cursorY, column: buffer.cursorX };
    }

    #active(): readonly Hyperlink[] {
        if (this.#terminal.buffer.active.type === 'alternate') {
            return this.#alternate;
        }
        this.#normal = this.#normal.filter((link) => link.start.marker?.isDisposed !== true);
        return this.#normal;
    }

    #contains(link: Hyperlink, cell: BufferCell): boolean {
        const position = this.#position(cell);
        return this.#position(link.start) <= position && position < this.#position(link.end);
    }

    #row(anchor: Anchor): number {
        return anchor.marker?.line ?? anchor.row;
    }

    #position(cell: Anchor | BufferCell): number {
        const row = 'marker' in cell ? this.#row(cell) : cell.row;
        return row * this.#terminal.cols + cell.column;
    }

    #text(link: Hyperlink): string {
        const buffer = this.#terminal.buffer.active;
        let text = '';
        for (let row = this.#row(link.start); row <= this.#row(link.end); row += 1) {
            const start = row === this.#row(link.start) ? link.start.column : 0;
            const end = row === this.#row(link.end) ? link.end.column : this.#terminal.cols;
            text += buffer.getLine(row)?.translateToString(false, start, end) ?? '';
        }
        return stripBidiControls(stripControlCharacters(text)).trim();
    }

    #providedLinks(row: number, modifier: LinkModifier, onActivate: (link: TerminalLink) => void): ILink[] {
        const buffer: IBuffer = this.#terminal.buffer.active;
        const line = new LogicalText(buffer, row, this.#terminal.cols);
        return detectLinks(line.text).map((link) => {
            const start = line.cellOf(link.start);
            const end = line.cellOf(link.end - 1);
            return {
                range: { start: { x: start.column + 1, y: start.row + 1 }, end: { x: end.column + 1, y: end.row + 1 } },
                text: link.target,
                activate: (event) => modifier(event) && onActivate({ text: link.target, target: link.target }),
            };
        });
    }

    #forget(links: readonly Hyperlink[]): void {
        for (const link of links) {
            link.start.marker?.dispose();
            link.end.marker?.dispose();
        }
    }
}

function unique(links: readonly TerminalLink[]): readonly TerminalLink[] {
    const seen = new Set<string>();
    return links.filter((link) => {
        const key = `${link.text}\n${link.target}`;
        const fresh = !seen.has(key);
        seen.add(key);
        return fresh;
    });
}

/**
 * Whether an OSC 8 target can become a link: not empty, no longer than the app opens, and free of control and
 * bidirectional formatting characters, so the List links dialog never shows a target that reads as another (SEC-06.4).
 */
function usableTarget(target: string): boolean {
    return (
        target !== '' &&
        target.length <= MAX_LINK_LENGTH &&
        stripControlCharacters(target) === target &&
        !hasBidiControls(target)
    );
}
