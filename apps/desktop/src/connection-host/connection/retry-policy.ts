import type { ConnectionFailure } from '../../shared/connection';

/** The first tries after a loss: at once, then after 1, 2 and 4 s (P-29). */
const FIRST_DELAYS_MS: readonly number[] = [0, 1_000, 2_000, 4_000];
/** Then a try every 5 s, so a network that comes back is used within NFR-07's 5 s… */
const STEADY_DELAY_MS = 5_000;
/** …for five minutes after the loss, and every 30 s after that. */
const STEADY_FOR_MS = 300_000;
const PATIENT_DELAY_MS = 30_000;
/** Each delay moves by up to a fifth either way, so hosts lost together do not retry in step. */
const JITTER = 0.2;

/**
 * Install problems that may pass by themselves: another client installing at the same moment, or an upload the
 * network cut or garbled. Every other install problem waits for the user (P-29).
 */
const TRANSIENT_INSTALL_CODES: ReadonlySet<string> = new Set(['lock-busy', 'short-upload', 'checksum-mismatch']);

/** How many install failures in a row are retried, each uploading the daemon again, before the user must Retry. */
export const MAX_INSTALL_RETRIES = 3;

/**
 * How long to wait before reconnect attempt `attempt` (1 for the first), `sinceLossMs` after the connection was lost.
 * `random` returns a number in [0, 1).
 */
export function retryDelayMs(attempt: number, sinceLossMs: number, random: () => number): number {
    const base = FIRST_DELAYS_MS[attempt - 1] ?? (sinceLossMs < STEADY_FOR_MS ? STEADY_DELAY_MS : PATIENT_DELAY_MS);
    return Math.round(base * (1 + JITTER * (2 * random() - 1)));
}

/**
 * Whether a failed attempt is retried on its own: network and host trouble may pass, but a failure only the user can
 * fix — the agent, a certificate, a host key, an unsupported or incompatible host, an install that cannot work —
 * waits for Retry (US-2.2.4).
 */
export function isRetryable(failure: ConnectionFailure): boolean {
    switch (failure.kind) {
        case 'dns':
        case 'unreachable':
        case 'timeout':
        case 'jump-failed':
        case 'no-answer':
        case 'other':
            return true;
        case 'install':
            return TRANSIENT_INSTALL_CODES.has(failure.code);
        default:
            return false;
    }
}
