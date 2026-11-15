import type { TerminalSize } from '@trc/protocol';

/** How long a size this client asked for still counts as its own when the daemon reports it. */
const OWN_SIZE_MS = 10_000;

interface Requested {
    readonly size: TerminalSize;
    readonly at: number;
}

/**
 * Which size a shared session's terminal shows and sends (US-2.6.2, P-31). The PTY follows the client that was last
 * active; while another client set it, this one shows the session at that size and sends nothing, until it takes the
 * size back on focus or input.
 */
export class SharedSize {
    readonly #now: () => number;
    #fitted: TerminalSize | undefined;
    #session: TerminalSize | undefined;
    #foreign = false;
    #requested: Requested[] = [];
    /**
     * The other client's size when this one took the size back, until the daemon reports another or 10 s pass: until
     * then a report of it is stale, sent before the daemon applied this client's size.
     */
    #stale: Requested | undefined;

    /** A policy that tells the time with `now`. */
    constructor(now: () => number = Date.now) {
        this.#now = now;
    }

    /** Whether another client set the session's size, which differs from the one this client fits. */
    get foreign(): boolean {
        return this.#foreign;
    }

    /** The size the terminal shows: the session's while another client set it, otherwise the one it fits. */
    get shown(): TerminalSize | undefined {
        return this.#foreign ? this.#session : this.#fitted;
    }

    /** The frame now fits `size`; returns the size to send when it changed, unless another client set the size. */
    fitted(size: TerminalSize): TerminalSize | undefined {
        const changed = this.#fitted === undefined || !same(this.#fitted, size);
        this.#fitted = size;
        return this.#foreign || !changed ? undefined : this.#request(size);
    }

    /** The daemon reports the session's size. */
    session(size: TerminalSize): void {
        this.#session = size;
        if (this.#awaitingClaim(size)) {
            return;
        }
        const mine = this.#requested.some((request) => this.#recent(request) && same(request.size, size));
        this.#foreign = !mine && this.#fitted !== undefined && !same(size, this.#fitted);
    }

    /** The user focused the terminal or typed: returns the size to send to take the size back, if another set it. */
    claim(): TerminalSize | undefined {
        if (!this.#foreign || this.#fitted === undefined) {
            return undefined;
        }
        this.#foreign = false;
        this.#stale = this.#session === undefined ? undefined : { size: this.#session, at: this.#now() };
        return this.#request(this.#fitted);
    }

    #awaitingClaim(size: TerminalSize): boolean {
        const stale = this.#stale;
        if (stale !== undefined && this.#recent(stale) && same(stale.size, size)) {
            return true;
        }
        this.#stale = undefined;
        return false;
    }

    #request(size: TerminalSize): TerminalSize {
        this.#requested = [...this.#requested.filter((request) => this.#recent(request)), { size, at: this.#now() }];
        return size;
    }

    #recent(request: Requested): boolean {
        return this.#now() - request.at < OWN_SIZE_MS;
    }
}

function same(left: TerminalSize, right: TerminalSize): boolean {
    return left.cols === right.cols && left.rows === right.rows;
}
