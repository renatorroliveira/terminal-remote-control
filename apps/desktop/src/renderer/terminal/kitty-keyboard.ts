import type { IDisposable, Terminal } from '@xterm/xterm';

/** How many entries a screen's stack keeps; a push onto a full stack evicts the oldest. */
const STACK_LIMIT = 16;
/** The five flags the protocol defines. */
const FLAG_MASK = 0b11111;
const SET_BITS = 2;
const RESET_BITS = 3;

type Params = (number | number[])[];

/**
 * Follows the kitty keyboard protocol flags programs push, pop and set in their output, with separate stacks for the
 * main and alternate screens, so the key encoder honors what the program asked for (D-30). The daemon's emulator
 * sees the same output and answers the flags query.
 */
export class KittyKeyboard implements IDisposable {
    readonly #terminal: Terminal;
    readonly #main = new FlagStack();
    readonly #alternate = new FlagStack();
    readonly #handlers: readonly IDisposable[];

    /** Starts following a terminal's output. */
    constructor(terminal: Terminal) {
        this.#terminal = terminal;
        const { parser } = terminal;
        this.#handlers = [
            parser.registerCsiHandler({ prefix: '>', final: 'u' }, (params) => this.#apply(params, 'push')),
            parser.registerCsiHandler({ prefix: '<', final: 'u' }, (params) => this.#apply(params, 'pop')),
            parser.registerCsiHandler({ prefix: '=', final: 'u' }, (params) => this.#apply(params, 'set')),
            parser.registerEscHandler({ final: 'c' }, () => this.#reset()),
        ];
    }

    /** The current flags of the screen in use. */
    get flags(): number {
        return this.#stack().current;
    }

    /** Stops following the output. */
    dispose(): void {
        for (const handler of this.#handlers) {
            handler.dispose();
        }
    }

    #apply(params: Params, operation: 'push' | 'pop' | 'set'): boolean {
        const stack = this.#stack();
        if (operation === 'push') {
            stack.push(param(params, 0, 0) & FLAG_MASK);
        } else if (operation === 'pop') {
            stack.pop(Math.max(1, param(params, 0, 1)));
        } else {
            stack.set(param(params, 0, 0) & FLAG_MASK, param(params, 1, 1));
        }
        return true;
    }

    #reset(): boolean {
        this.#main.clear();
        this.#alternate.clear();
        return false;
    }

    #stack(): FlagStack {
        return this.#terminal.buffer.active.type === 'alternate' ? this.#alternate : this.#main;
    }
}

/** One screen's flags: the last entry is the current flags. */
class FlagStack {
    #entries: number[] = [0];

    get current(): number {
        return this.#entries.at(-1) ?? 0;
    }

    push(flags: number): void {
        this.#entries = [...this.#entries.slice(this.#entries.length >= STACK_LIMIT ? 1 : 0), flags];
    }

    pop(count: number): void {
        const keep = this.#entries.length - count;
        this.#entries = keep >= 1 ? this.#entries.slice(0, keep) : [0];
    }

    set(flags: number, mode: number): void {
        const current = this.current;
        const next = mode === SET_BITS ? current | flags : mode === RESET_BITS ? current & ~flags : flags;
        this.#entries = [...this.#entries.slice(0, -1), next];
    }

    clear(): void {
        this.#entries = [0];
    }
}

function param(params: Params, index: number, fallback: number): number {
    const value = params[index];
    return typeof value === 'number' && value > 0 ? value : fallback;
}
