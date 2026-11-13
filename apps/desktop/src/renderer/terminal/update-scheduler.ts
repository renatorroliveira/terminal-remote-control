/** The ATS update interval while assistive technology runs: at most about 4 updates a second (S3a, R2). */
const AT_INTERVAL_MS = 250;
/** Output above this much per interval is a flood (256 KiB/s, S3a). */
const FLOOD_BYTES_PER_INTERVAL = 64 * 1024;
/** How long the ATS holds still after flood-rate output. */
const FLOOD_HOLD_MS = 500;
/** How long after a keystroke output counts as its echo. */
const ECHO_WINDOW_MS = 300;

/**
 * Schedules ATS updates. Without assistive technology it updates once per animation frame. With it, the echo of
 * typing still updates on the next frame, so the caret and the typed text reach the screen reader and the
 * magnifier at once (NFR-02, A11Y-06); other output updates at most every 250 ms, and nothing updates while a flood
 * lasts, because Chromium re-serializes every changed accessibility node.
 */
export class UpdateScheduler {
    readonly #update: () => void;
    readonly #assistiveTechnology: () => boolean;
    #pending: { readonly fast: boolean; readonly cancel: () => void } | undefined;
    #lastRun = Number.NEGATIVE_INFINITY;
    #lastInput = Number.NEGATIVE_INFINITY;
    #windowStart = 0;
    #windowBytes = 0;
    #holdUntil = 0;
    #disposed = false;

    /** A scheduler running `update`; `assistiveTechnology` reports whether AT is active. */
    constructor(update: () => void, assistiveTechnology: () => boolean) {
        this.#update = update;
        this.#assistiveTechnology = assistiveTechnology;
    }

    /** Asks for an update. */
    request(): void {
        if (this.#disposed) {
            return;
        }
        const fast = !this.#assistiveTechnology() || performance.now() - this.#lastInput <= ECHO_WINDOW_MS;
        if (this.#pending !== undefined && (this.#pending.fast || !fast)) {
            return;
        }
        this.#pending?.cancel();
        this.#pending = fast ? this.#nextFrame() : this.#nextInterval();
    }

    /** Records a keystroke or other input; output in the next 300 ms is its echo. */
    input(): void {
        this.#lastInput = performance.now();
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

    /** Cancels the pending update; requests do nothing from now on, so no update runs against a disposed terminal. */
    dispose(): void {
        this.#disposed = true;
        this.#pending?.cancel();
        this.#pending = undefined;
    }

    #nextFrame() {
        const handle = requestAnimationFrame(() => this.#run());
        return { fast: true, cancel: () => cancelAnimationFrame(handle) };
    }

    #nextInterval() {
        const delay = Math.max(0, this.#lastRun + AT_INTERVAL_MS - performance.now());
        const handle = setTimeout(() => this.#run(), delay);
        return { fast: false, cancel: () => clearTimeout(handle) };
    }

    #run(): void {
        const now = performance.now();
        if (this.#assistiveTechnology() && now < this.#holdUntil) {
            const handle = setTimeout(() => this.#run(), this.#holdUntil - now);
            this.#pending = { fast: false, cancel: () => clearTimeout(handle) };
            return;
        }
        this.#pending = undefined;
        this.#lastRun = now;
        this.#update();
    }
}
