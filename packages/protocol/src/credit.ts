/** Output bytes a client may receive before it grants more (TECH_STACK §6). */
export const CREDIT_WINDOW = 256 * 1024;
/** Rendered bytes are returned to the daemon once they reach this step. */
export const CREDIT_STEP = 64 * 1024;

/** Credit rendered but not yet returned, and the grant to send now (0 for none). */
export interface CreditAccrual {
    readonly pending: number;
    readonly grant: number;
}

/** Adds rendered bytes to the pending credit and returns what to grant, in steps of {@link CREDIT_STEP}. */
export function accrueCredit(pending: number, rendered: number): CreditAccrual {
    const total = pending + rendered;
    return total >= CREDIT_STEP ? { pending: 0, grant: total } : { pending: total, grant: 0 };
}
