import { accrueCredit } from '@trc/protocol';

/** Returns output credit to the daemon as xterm finishes parsing what it received, in 64 KiB steps (D-19). */
export class CreditTracker {
    readonly #grant: (bytes: number) => void;
    #pending = 0;

    /** A tracker that grants with `grant`. */
    constructor(grant: (bytes: number) => void) {
        this.#grant = grant;
    }

    /** Records bytes xterm has parsed. */
    parsed(bytes: number): void {
        const accrual = accrueCredit(this.#pending, bytes);
        this.#pending = accrual.pending;
        if (accrual.grant > 0) {
            this.#grant(accrual.grant);
        }
    }
}
