import { afterEach, describe, it } from 'vitest';
import type { LiveHost } from '../nfr/live-host';
import { testHostsMissing } from '../nfr/live-host';
import { CYCLES, endSsh, SoakRun, signalSsh } from './soak';

/**
 * Network flaps, 1,000 times (NFR-11, US-2.2): the network goes away, so the app's ssh connection stalls while the
 * daemon still holds it; the app connects again and resumes every session from where its output stood, and the output
 * written meanwhile arrives exactly once. The stalled connection is killed at the next cycle, as its TCP connection
 * would time out.
 */
const runs: SoakRun[] = [];
const stalled: LiveHost[] = [];
afterEach(() => {
    endStalled();
    for (const run of runs.splice(0)) {
        run.remove();
    }
});

/** Ends the connections earlier cycles left stalled. */
function endStalled(): void {
    for (const host of stalled.splice(0)) {
        endSsh(host);
        host.connection.close();
    }
}

describe.skipIf(testHostsMissing() !== undefined)('soak: network flaps (NFR-11, US-2.2)', () => {
    it('stalls the ssh connection, connects again and resumes every session, and every session stays', async () => {
        const run = new SoakRun(process.env['TRC_SOAK_HOST'] ?? 'trc-alpine');
        runs.push(run);
        await run.start(3);
        await run.soak(CYCLES, async (_, cycle) => {
            const lost = run.host;
            signalSsh(lost, 'STOP');
            endStalled();
            stalled.push(lost);
            run.away(cycle);
            run.resumeFrom(lost);
            return run.connect();
        });
        run.report('network flap (connection stalled, then a new one)', CYCLES);
    });
});
