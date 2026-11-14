/** How long the page has to answer a quit before the app quits anyway, so quitting never hangs. */
const ANSWER_MS = 2_000;

/** What the quit guard needs from the app. */
export interface QuitGuardOptions {
    /** Whether the first-quit notice was shown at an earlier quit. */
    readonly noticeShown: boolean;
    /** Keeps that the notice was shown, in `config.json`. */
    readonly markShown: () => void;
    /** Asks the page to quit or show the notice; false when no page can. */
    readonly ask: () => boolean;
    /** Quits the app. */
    readonly quit: () => void;
}

/**
 * Holds the first quit until the page has decided: it quits at once when no session runs, or shows the first-quit
 * notice, which is never shown again (US-2.1.5, P-26). Every later quit, and a quit the page allowed, goes ahead; a
 * page that cannot answer, or does not within 2 s, lets the app quit, as sessions keep running anyway (US-2.1.1).
 */
export class QuitGuard {
    readonly #options: QuitGuardOptions;
    #noticeShown: boolean;
    #allowed = false;
    #asking = false;
    #timer: ReturnType<typeof setTimeout> | undefined;

    /** A guard for an app whose notice was or was not shown before. */
    constructor(options: QuitGuardOptions) {
        this.#options = options;
        this.#noticeShown = options.noticeShown;
    }

    /** Runs on `before-quit` and on the window's `close`: lets the quit go, or holds it and asks the page. */
    beforeQuit(event: { preventDefault(): void }): void {
        if (this.#allowed || this.#noticeShown) {
            return;
        }
        event.preventDefault();
        if (this.#asking) {
            return;
        }
        if (!this.#options.ask()) {
            this.quit();
            return;
        }
        this.#asking = true;
        this.#timer = setTimeout(() => this.quit(), ANSWER_MS);
    }

    /** The page shows the first-quit notice; it is never shown again, and the user decides without a time limit. */
    noticeOpened(): void {
        clearTimeout(this.#timer);
        this.#asking = false;
        this.#noticeShown = true;
        this.#options.markShown();
    }

    /** Quits now: the page found no session running, or the user chose to quit. */
    quit(): void {
        clearTimeout(this.#timer);
        this.#allowed = true;
        this.#options.quit();
    }
}
