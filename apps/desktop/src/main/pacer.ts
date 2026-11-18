/**
 * Lets something happen at most once every `intervalMs`, so a page that asks too often is refused instead of
 * flooding the OS, such as the clipboard with copies (SEC-06).
 */
export class Pacer {
    readonly #intervalMs: number;
    readonly #now: () => number;
    #last = Number.NEGATIVE_INFINITY;

    /** A pacer of one every `intervalMs`, reading the time from `now`. */
    constructor(intervalMs: number, now: () => number = Date.now) {
        this.#intervalMs = intervalMs;
        this.#now = now;
    }

    /** Whether it may happen now, which it then records. */
    allow(): boolean {
        const now = this.#now();
        if (now - this.#last < this.#intervalMs) {
            return false;
        }
        this.#last = now;
        return true;
    }
}
