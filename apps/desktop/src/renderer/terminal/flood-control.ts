/** The window the output rate is measured over. */
const WINDOW_MS = 1_000;

interface Burst {
    readonly at: number;
    readonly lines: number;
}

/**
 * Decides when output comes faster than speech can follow (A11Y-02.3): more lines in one second than the threshold
 * starts a flood, which holds the lines and counts them until output pauses.
 */
export class FloodControl {
    readonly #threshold: () => number;
    readonly #now: () => number;
    #recent: Burst[] = [];
    #held: number | undefined;

    /** Floods past `threshold` lines a second, on the clock `now` in milliseconds. */
    constructor(threshold: () => number, now: () => number) {
        this.#threshold = threshold;
        this.#now = now;
    }

    /** Whether a flood is holding lines now. */
    get flooding(): boolean {
        return this.#held !== undefined;
    }

    /** Admits `lines` new lines: true when they may be spoken, false when a flood holds them. */
    admit(lines: number): boolean {
        if (this.#held !== undefined) {
            this.#held += lines;
            return false;
        }
        const now = this.#now();
        this.#recent = [...this.#recent.filter((burst) => burst.at > now - WINDOW_MS), { at: now, lines }];
        const total = this.#recent.reduce((sum, burst) => sum + burst.lines, 0);
        if (total <= this.#threshold()) {
            return true;
        }
        this.#held = lines;
        return false;
    }

    /** Ends a flood once output paused: how many lines it held, or undefined when there was none. */
    end(): number | undefined {
        const held = this.#held;
        this.reset();
        return held;
    }

    /** Forgets the flood and the recent rate. */
    reset(): void {
        this.#held = undefined;
        this.#recent = [];
    }
}
