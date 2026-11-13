import { RESERVED_REQUEST_IDS } from '../../shared/connection';

/** How often the connection pings the daemon. */
const PING_INTERVAL_MS = 5_000;
/** How long a ping may stay unanswered before the connection counts as dead (NFR-07). */
const PING_TIMEOUT_MS = 15_000;

/**
 * Application-level liveness on top of ssh's keepalives: a ping every 5 s and a timeout 15 s after an unanswered
 * one, so a dead connection is detected well within NFR-07's 30 s.
 */
export class Pinger {
    readonly #send: (requestId: number) => void;
    readonly #onTimeout: () => void;
    #timer: ReturnType<typeof setInterval> | undefined;
    #watchdogTimer: ReturnType<typeof setTimeout> | undefined;
    #next = RESERVED_REQUEST_IDS;
    #outstanding: { readonly id: number; readonly sentAt: number } | undefined;

    /** Creates a pinger that sends with `send` and reports a dead connection once with `onTimeout`. */
    constructor(send: (requestId: number) => void, onTimeout: () => void) {
        this.#send = send;
        this.#onTimeout = onTimeout;
    }

    /** Starts pinging. */
    start(): void {
        this.#timer = setInterval(() => this.#tick(), PING_INTERVAL_MS);
    }

    /** Records a pong. */
    pong(requestId: number): void {
        if (this.#outstanding?.id === requestId) {
            this.#outstanding = undefined;
        }
    }

    /** Stops pinging. */
    stop(): void {
        clearInterval(this.#timer);
        clearTimeout(this.#watchdogTimer);
        this.#timer = undefined;
        this.#watchdogTimer = undefined;
    }

    #tick(): void {
        if (this.#outstanding === undefined) {
            this.#outstanding = { id: this.#next, sentAt: Date.now() };
            this.#next = this.#next + 1 > 0xffff_ffff ? RESERVED_REQUEST_IDS : this.#next + 1;
            this.#send(this.#outstanding.id);
            this.#watchdog();
        }
    }

    #watchdog(): void {
        const sent = this.#outstanding;
        clearTimeout(this.#watchdogTimer);
        this.#watchdogTimer = setTimeout(() => {
            if (this.#timer !== undefined && this.#outstanding === sent) {
                this.stop();
                this.#onTimeout();
            }
        }, PING_TIMEOUT_MS);
    }
}
