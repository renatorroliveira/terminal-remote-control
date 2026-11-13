/** How often a drag past an edge scrolls. */
const TICK_MS = 50;
/** The most lines one tick scrolls, however far past the edge the pointer is. */
const MAX_LINES_PER_TICK = 10;

/** What the autoscroll drives. */
export interface AutoScrollTarget {
    /** The scrolling area's bounds on screen. */
    bounds(): DOMRect;
    /** One row's height, in CSS pixels. */
    rowHeight(): number;
    /** Scrolls by `lines` (negative is up) and extends the selection to the edge row under `clientX`. */
    scrollSelection(lines: number, clientX: number): void;
}

/**
 * Scrolls a pointer selection while the pointer is past the top or bottom edge, one line per tick at the edge and
 * up to ten farther away, as native text views do (A11Y-04).
 */
export class SelectionAutoScroll {
    readonly #target: AutoScrollTarget;
    #timer: ReturnType<typeof setInterval> | undefined;
    #lines = 0;
    #clientX = 0;

    /** Creates an autoscroll for a target. */
    constructor(target: AutoScrollTarget) {
        this.#target = target;
    }

    /** Follows the pointer during a drag: scrolls while it is past an edge, and stops when it comes back. */
    move(clientX: number, clientY: number): void {
        const bounds = this.#target.bounds();
        const past = clientY > bounds.bottom ? clientY - bounds.bottom : Math.min(0, clientY - bounds.top);
        const speed = Math.min(MAX_LINES_PER_TICK, Math.ceil(Math.abs(past) / Math.max(1, this.#target.rowHeight())));
        this.#clientX = clientX;
        this.#lines = Math.sign(past) * speed;
        if (this.#lines === 0) {
            this.stop();
        } else {
            this.#timer ??= setInterval(() => this.#target.scrollSelection(this.#lines, this.#clientX), TICK_MS);
        }
    }

    /** Stops scrolling. */
    stop(): void {
        clearInterval(this.#timer);
        this.#timer = undefined;
    }
}
