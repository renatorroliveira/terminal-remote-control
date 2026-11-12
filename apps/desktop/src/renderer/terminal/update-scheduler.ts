/** The ATS update interval while assistive technology runs: at most about 4 updates a second (S3a, R2). */
const AT_INTERVAL_MS = 250;
/** Output above this much per interval is a flood (256 KiB/s, S3a). */
const FLOOD_BYTES_PER_INTERVAL = 64 * 1024;
/** How long the ATS holds still after flood-rate output. */
const FLOOD_HOLD_MS = 500;

/**
 * Schedules ATS updates. Without assistive technology it updates once per animation frame; with it, at most every
 * 250 ms, and not at all while a flood lasts, because Chromium re-serializes every changed accessibility node.
 */
export class UpdateScheduler {
    readonly #update: () => void;
    readonly #assistiveTechnology: () => boolean;
    #scheduled = false;
    #lastRun = Number.NEGATIVE_INFINITY;
    #windowStart = 0;
    #windowBytes = 0;
    #holdUntil = 0;

    /** A scheduler running `update`; `assistiveTechnology` reports whether AT is active. */
    constructor(update: () => void, assistiveTechnology: () => boolean) {
        this.#update = update;
        this.#assistiveTechnology = assistiveTechnology;
    }

    /** Asks for an update. */
    request(): void {
        if (this.#scheduled) {
            return;
        }
        this.#scheduled = true;
        if (this.#assistiveTechnology()) {
            setTimeout(() => this.#run(), Math.max(0, this.#lastRun + AT_INTERVAL_MS - performance.now()));
        } else {
            requestAnimationFrame(() => this.#run());
        }
    }

    /** Records output, which may start a flood hold. */
    output(bytes: number): void {
        const now = performance.now();
        if (now - this.#windowStart >= AT_INTERVAL_MS) {
            this.#windowStart = now;
            this.#windowBytes = 0;
        }
        this.#windowBytes += bytes;
        if (this.#windowBytes > FLOOD_BYTES_PER_INTERVAL) {
            this.#holdUntil = now + FLOOD_HOLD_MS;
        }
    }

    #run(): void {
        const now = performance.now();
        if (this.#assistiveTechnology() && now < this.#holdUntil) {
            setTimeout(() => this.#run(), this.#holdUntil - now);
            return;
        }
        this.#scheduled = false;
        this.#lastRun = now;
        this.#update();
    }
}
