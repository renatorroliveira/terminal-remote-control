import type { IDisposable, IMarker, Terminal } from '@xterm/xterm';

/**
 * The most commands a terminal keeps marks for; older ones are forgotten. Each mark costs every scrolled line a
 * little, so the app keeps fewer than the daemon's 1,000 (P-79, P-82).
 */
export const MAX_COMMANDS = 300;

/** A place a mark was made: a marker that follows its row, and the column the cursor was in. */
export interface MarkSpot {
    readonly marker: IMarker;
    readonly column: number;
}

/** One command as shell integration marked it (US-5.2): its prompt, its output's start and end, and its exit code. */
export interface MarkedCommand {
    readonly prompt: MarkSpot;
    /** Where the user typed the command, which a prompt of several lines draws below its first. */
    readonly input: MarkSpot | undefined;
    readonly output: MarkSpot | undefined;
    readonly end: MarkSpot | undefined;
    readonly exitCode: number | undefined;
    /** Whether it is an iTerm2 `SetMark`, a marked row with no command (OQ-6, P-69). */
    readonly bookmark: boolean;
}

/** What the marks report. */
export interface CommandMarksOptions {
    /** A command finished in live output, not in a replay, with its exit code when the shell gave one (US-5.2.2). */
    readonly onFinished: (exitCode: number | undefined) => void;
}

interface Entry {
    readonly prompt: MarkSpot;
    input: MarkSpot | undefined;
    output: MarkSpot | undefined;
    end: MarkSpot | undefined;
    exitCode: number | undefined;
    readonly bookmark: boolean;
}

type Step =
    | { readonly kind: 'prompt' }
    | { readonly kind: 'input' }
    | { readonly kind: 'output' }
    | { readonly kind: 'end'; readonly exitCode: number | undefined };

/**
 * The commands in a terminal's normal buffer, read from OSC 133 and iTerm2's `SetMark` (US-5.1.2, P-69), with the
 * daemon's repairs (P-74): a prompt redrawn on its row counts once, a prompt where no command ran gives way to the
 * next, an output start needs a prompt and an end an output start, and each counts once. Marks follow their rows
 * through scrolling and reflow, and leave with the rows the scrollback drops. The alternate screen is never marked.
 * No mark acts on anything (SEC-06).
 */
export class CommandMarks {
    readonly #terminal: Terminal;
    readonly #options: CommandMarksOptions;
    readonly #handlers: readonly IDisposable[];
    #entries: Entry[] = [];
    #held = false;

    /** Starts reading `terminal`'s marks. */
    constructor(terminal: Terminal, options: CommandMarksOptions) {
        this.#terminal = terminal;
        this.#options = options;
        this.#handlers = [
            terminal.parser.registerOscHandler(133, (data) => this.#semanticPrompt(data)),
            terminal.parser.registerOscHandler(1337, (data) => this.#iterm(data)),
        ];
    }

    /** The commands still in the buffer, oldest first. */
    get commands(): readonly MarkedCommand[] {
        this.#prune();
        return this.#entries;
    }

    /** Keeps marking but reports no end, while a replay rebuilds commands that already finished. */
    hold(): void {
        this.#held = true;
    }

    /** Reports ends again. */
    release(): void {
        this.#held = false;
    }

    /** Forgets every command, as the buffer they marked was reset. */
    reset(): void {
        for (const entry of this.#entries) {
            disposeEntry(entry);
        }
        this.#entries = [];
    }

    /** Stops reading marks and forgets them. */
    dispose(): void {
        for (const handler of this.#handlers) {
            handler.dispose();
        }
        this.reset();
    }

    #semanticPrompt(data: string): boolean {
        const step = parseStep(data);
        if (step !== undefined && this.#terminal.buffer.active.type === 'normal') {
            this.#apply(step);
        }
        return true;
    }

    #iterm(data: string): boolean {
        if (data === 'SetMark' && this.#terminal.buffer.active.type === 'normal') {
            this.#addPrompt(true);
        }
        return true;
    }

    #apply(step: Step): void {
        const last = this.#entries.at(-1);
        switch (step.kind) {
            case 'prompt':
                this.#addPrompt(false);
                break;
            case 'input':
                if (last !== undefined && !last.bookmark && last.output === undefined) {
                    this.#markInput(last);
                }
                break;
            case 'output':
                if (last !== undefined && !last.bookmark && last.output === undefined) {
                    last.output = this.#spot();
                }
                break;
            case 'end':
                if (last?.output !== undefined && last.end === undefined) {
                    last.end = this.#spot();
                    last.exitCode = step.exitCode;
                    this.#finished(step.exitCode);
                }
                break;
        }
    }

    #addPrompt(bookmark: boolean): void {
        const buffer = this.#terminal.buffer.active;
        const row = buffer.baseY + buffer.cursorY;
        const last = this.#entries.at(-1);
        const idle = last !== undefined && last.output === undefined;
        if (idle && last.prompt.marker.line === row && (last.bookmark === bookmark || !last.bookmark)) {
            return;
        }
        if (idle && !bookmark && (!last.bookmark || last.prompt.marker.line === row)) {
            disposeEntry(last);
            this.#entries.pop();
        }
        const entry = {
            prompt: this.#spot(),
            input: undefined,
            output: undefined,
            end: undefined,
            exitCode: undefined,
        };
        this.#entries.push({ ...entry, bookmark });
        if (this.#entries.length > MAX_COMMANDS) {
            this.#entries.splice(0, this.#entries.length - MAX_COMMANDS).forEach(disposeEntry);
        }
    }

    /** Marks where the command is typed, when a prompt of several lines puts it below the prompt's first row. */
    #markInput(entry: Entry): void {
        const buffer = this.#terminal.buffer.active;
        if (entry.input === undefined && buffer.baseY + buffer.cursorY !== entry.prompt.marker.line) {
            entry.input = this.#spot();
        }
    }

    #spot(): MarkSpot {
        return { marker: this.#terminal.registerMarker(0), column: this.#terminal.buffer.active.cursorX };
    }

    #finished(exitCode: number | undefined): void {
        if (!this.#held) {
            this.#options.onFinished(exitCode);
        }
    }

    #prune(): void {
        const kept = this.#entries.findIndex((entry) => !entry.prompt.marker.isDisposed);
        const drop = kept === -1 ? this.#entries.length : kept;
        this.#entries.splice(0, drop).forEach(disposeEntry);
    }
}

function parseStep(data: string): Step | undefined {
    const [kind, ...params] = data.split(';');
    switch (kind) {
        case 'A':
            return params.some((param) => param.startsWith('k=') && param !== 'k=i') ? undefined : { kind: 'prompt' };
        case 'B':
            return { kind: 'input' };
        case 'C':
            return { kind: 'output' };
        case 'D':
            return { kind: 'end', exitCode: exitCodeOf(params[0]) };
        default:
            return undefined;
    }
}

function exitCodeOf(param: string | undefined): number | undefined {
    return param !== undefined && /^-?\d{1,10}$/.test(param) ? Number(param) : undefined;
}

function disposeEntry(entry: Entry): void {
    entry.prompt.marker.dispose();
    entry.input?.marker.dispose();
    entry.output?.marker.dispose();
    entry.end?.marker.dispose();
}
