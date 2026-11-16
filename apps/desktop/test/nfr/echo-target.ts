/**
 * NFR-02's target (owner, 2026-11-16): at p99, the app and the daemon add at most one 60 Hz display frame to the SSH
 * round trip, so a typed character shows, and is spoken, no more than a frame after it would in a native terminal.
 */
export const ECHO_PERCENTILE = 99;

/** One display frame at 60 Hz, in ms: what NFR-02 lets the app and the daemon add to the round trip. */
export const ECHO_ALLOWANCE_MS = 1_000 / 60;

/** Echo samples a p99 needs to rest on more than the single slowest one. */
export const ECHO_SAMPLES = 200;
