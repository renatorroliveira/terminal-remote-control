/** How long the cursor keeps blinking without input (A11Y-08.1). */
export const BLINK_IDLE_MS = 5_000;

/** The terminal option the blink controls. */
export interface BlinkTarget {
    cursorBlink?: boolean | undefined;
}

/** Whether the user wants a blinking cursor, and whether the OS reduces motion. */
export interface BlinkWish {
    readonly wanted: boolean;
    readonly reducedMotion: boolean;
}

/**
 * Blinks the cursor only while the user wants it and the OS does not reduce motion, and stops it after 5 seconds
 * without input until the next key (A11Y-08.1).
 */
export class CursorBlink {
    readonly #target: BlinkTarget;
    #allowed = false;
    #idle: ReturnType<typeof setTimeout> | undefined;

    /** Controls `target.cursorBlink`, usually `terminal.options`. */
    constructor(target: BlinkTarget) {
        this.#target = target;
    }

    /** Applies what the user wants and whether the OS reduces motion. */
    set(wish: BlinkWish): void {
        this.#allowed = wish.wanted && !wish.reducedMotion;
        this.input();
    }

    /** The user typed: blinking resumes when allowed, and stops again after 5 seconds without input. */
    input(): void {
        clearTimeout(this.#idle);
        this.#target.cursorBlink = this.#allowed;
        if (this.#allowed) {
            this.#idle = setTimeout(() => {
                this.#target.cursorBlink = false;
            }, BLINK_IDLE_MS);
        }
    }

    /** Stops the idle timer. */
    dispose(): void {
        clearTimeout(this.#idle);
    }
}
