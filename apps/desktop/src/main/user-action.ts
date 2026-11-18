/** How long after the user's last key press or menu choice the page may still act on it. */
export const USER_ACTION_WINDOW_MS = 5_000;

/**
 * When the user last pressed a key in the window or chose a menu item, which the main process sees itself, so a
 * request that must follow a user action, such as copying a command's output, is refused otherwise (SEC-06).
 */
export class UserActionClock {
    readonly #now: () => number;
    #last = Number.NEGATIVE_INFINITY;

    /** A clock that reads the time from `now`. */
    constructor(now: () => number = Date.now) {
        this.#now = now;
    }

    /** Records a key press or a menu choice. */
    note(): void {
        this.#last = this.#now();
    }

    /** Whether the user acted within {@link USER_ACTION_WINDOW_MS}. */
    recent(): boolean {
        return this.#now() - this.#last <= USER_ACTION_WINDOW_MS;
    }
}
