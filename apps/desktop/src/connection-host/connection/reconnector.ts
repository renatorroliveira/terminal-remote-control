import type { ConnectionFailure, ConnectionState } from '../../shared/connection';
import { isRetryable, MAX_INSTALL_RETRIES, retryDelayMs } from './retry-policy';

/** The clock and randomness a reconnector uses, replaceable in tests. */
export interface ReconnectClock {
    now(): number;
    random(): number;
    setTimeout(callback: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
}

/** The real clock. */
export const SYSTEM_CLOCK: ReconnectClock = {
    now: () => Date.now(),
    random: () => Math.random(),
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** How a host was connected, which decides whether a failed first connection is retried. */
export interface EnableOptions {
    /** The launch restores it, so even its first connection retries (US-2.3.3); otherwise the user is there to see it. */
    readonly restore?: boolean;
}

/**
 * Reconnects one host by itself after a loss, and after failed attempts the network may fix, with P-29's backoff
 * (US-2.2.2, US-2.3.3, NFR-07). Between attempts it reports `reconnecting`, with the attempt, when the next one starts
 * and why the last one failed. A failure only the user can fix stops it until Retry (US-2.2.4); so does a host key
 * prompt, a disconnect the user asked for, or Stop retrying (US-2.2.3). A first connection the user started that fails
 * is theirs to see and retry (US-1.3), unless the launch restores the host.
 */
export class Reconnector {
    readonly #connect: () => void;
    readonly #report: (state: ConnectionState) => void;
    readonly #clock: ReconnectClock;
    #enabled = false;
    /** Failures retry: the host connected or was lost since it was enabled, or the launch restores it. */
    #armed = false;
    #attempt = 0;
    #lostAt: number | undefined;
    #timer: unknown;
    /** Install failures retried in a row since the host connected, the user connected it, or another failure. */
    #installRetries = 0;

    /** A reconnector that attempts with `connect` and reports `reconnecting` with `report`. */
    constructor(connect: () => void, report: (state: ConnectionState) => void, clock: ReconnectClock = SYSTEM_CLOCK) {
        this.#connect = connect;
        this.#report = report;
        this.#clock = clock;
    }

    /** Whether an attempt is scheduled. */
    get waiting(): boolean {
        return this.#timer !== undefined;
    }

    /** Lets the host reconnect on its own from now on: the user or, with `restore`, the launch connected it. */
    enable(options: EnableOptions = {}): void {
        this.#enabled = true;
        this.#armed ||= options.restore === true;
        this.#installRetries = 0;
    }

    /** Stops reconnecting: the user disconnected or chose Stop retrying. */
    disable(): void {
        this.#enabled = false;
        this.#armed = false;
        this.#cancel();
        this.#attempt = 0;
        this.#lostAt = undefined;
    }

    /** Whether `state` is a failure this reconnector retries, which it reports as `reconnecting` instead. */
    retries(state: ConnectionState): boolean {
        if (!this.#enabled || !this.#armed || state.status !== 'failed' || !isRetryable(state.failure)) {
            return false;
        }
        return state.failure.kind !== 'install' || this.#installRetries < MAX_INSTALL_RETRIES;
    }

    /** Follows the connection's state: a loss or a retryable failure schedules the next attempt. */
    onState(state: ConnectionState): void {
        switch (state.status) {
            case 'connected':
                this.#armed = true;
                this.#attempt = 0;
                this.#lostAt = undefined;
                this.#installRetries = 0;
                return;
            case 'disconnected':
                this.#armed = true;
                this.#schedule(undefined);
                return;
            case 'failed':
                if (this.retries(state)) {
                    this.#installRetries = state.failure.kind === 'install' ? this.#installRetries + 1 : 0;
                    this.#schedule(state.failure);
                } else {
                    this.#cancel();
                }
                return;
            case 'host-key':
            case 'closed':
                this.#cancel();
                return;
            default:
                return;
        }
    }

    /**
     * Tries now and starts the backoff again, after a network change, a wake, or the user's Retry (P-29, P-34): this
     * try is the sequence's first, so the next waits 1 s.
     */
    retryNow(): void {
        if (!this.#enabled || this.#timer === undefined) {
            return;
        }
        this.#cancel();
        this.#attempt = 1;
        this.#lostAt = this.#clock.now();
        this.#fire();
    }

    #schedule(failure: ConnectionFailure | undefined): void {
        if (!this.#enabled) {
            return;
        }
        this.#cancel();
        const now = this.#clock.now();
        this.#lostAt ??= now;
        this.#attempt += 1;
        const delay = retryDelayMs(this.#attempt, now - this.#lostAt, () => this.#clock.random());
        this.#report({ status: 'reconnecting', attempt: this.#attempt, nextAttemptAt: now + delay, failure });
        this.#timer = this.#clock.setTimeout(() => this.#fire(), delay);
    }

    #fire(): void {
        this.#timer = undefined;
        if (this.#enabled) {
            this.#connect();
        }
    }

    #cancel(): void {
        if (this.#timer !== undefined) {
            this.#clock.clearTimeout(this.#timer);
            this.#timer = undefined;
        }
    }
}
