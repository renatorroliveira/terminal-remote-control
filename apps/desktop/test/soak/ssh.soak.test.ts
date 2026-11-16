import { afterEach, describe, it } from 'vitest';
import { testHostsMissing } from '../nfr/live-host';
import { CYCLES, ended, SoakRun, signalSsh } from './soak';

/**
 * What an app quit or crash does to a host, 1,000 times each (NFR-11, P-25): the app's ssh connection closes, or its
 * ssh process is killed, and the next connection finds every session as it was.
 */
const runs: SoakRun[] = [];
afterEach(() => {
    for (const run of runs.splice(0)) {
        run.remove();
    }
});

describe.skipIf(testHostsMissing() !== undefined)('soak: the app quits or crashes (NFR-11, US-2.1.1)', () => {
    it('closes the ssh connection, as a quit does, and every session stays', async () => {
        const run = new SoakRun(process.env['TRC_SOAK_HOST'] ?? 'trc-alpine');
        runs.push(run);
        await run.start(3);
        await run.soak(CYCLES, async (_, cycle) => {
            const host = run.host;
            host.connection.close();
            await ended(host);
            run.away(cycle);
            return run.connect();
        });
        run.report('app quit (ssh connection closed)', CYCLES);
    });

    it('kills the ssh process, as a crash or a force-kill does, and every session stays', async () => {
        const run = new SoakRun(process.env['TRC_SOAK_HOST'] ?? 'trc-rocky');
        runs.push(run);
        await run.start(3);
        await run.soak(CYCLES, async (_, cycle) => {
            const host = run.host;
            signalSsh(host, 'KILL');
            await ended(host);
            run.away(cycle);
            return run.connect();
        });
        run.report('app crash (ssh process killed)', CYCLES);
    });
});
