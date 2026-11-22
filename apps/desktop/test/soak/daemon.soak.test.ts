import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ssh, testHostsMissing, waitFor } from '../nfr/live-host';
import { CYCLES, corePid, ended, OLD_DAEMONS, SoakRun } from './soak';

/**
 * Daemon kills and upgrades, 1,000 times each (NFR-11, US-2.5, S6): the core dies, detached or under systemd with
 * lingering, and the next connection's core adopts every holder; or a 0.2.0 core gives way to this build's.
 */
const runs: SoakRun[] = [];
afterEach(() => {
    for (const run of runs.splice(0)) {
        run.remove();
    }
});

const oldMissing = existsSync(join(OLD_DAEMONS, 'manifest.json'))
    ? undefined
    : 'run node tools/test-hosts/fetch-old-daemon.ts';

/**
 * How long a cycle waits for systemd to restart a killed core (`RestartSec=1`). Cycles kill it faster than systemd's
 * start limit (5 starts in 10 s) allows, so systemd stops restarting it at times; the next connection's bridge then
 * starts the core, as an app's would.
 */
const SYSTEMD_RESTART_MS = 3_000;

/** Kills the run's core and connects again, so the next core adopts every holder. */
async function killCore(run: SoakRun, cycle: number): Promise<SoakRun['host']> {
    await stopCore(run);
    run.away(cycle);
    return run.connect();
}

/** Kills the run's core with SIGKILL, and waits for systemd to restart it when it ran under systemd. */
async function stopCore(run: SoakRun): Promise<void> {
    const before = corePid(run);
    const host = run.host;
    const state = host.states.at(-1);
    const systemd = state?.status === 'connected' && state.daemon.service?.manager === 'systemd';
    ssh(run.alias, `kill -KILL ${before}`);
    await ended(host);
    if (systemd) {
        await waitFor(() => corePid(run) !== before, SYSTEMD_RESTART_MS).catch(() => undefined);
    }
}

/**
 * Stops the run's core for good, with its systemd unit when it runs as one, so systemd does not restart this build's
 * core before the 0.2.0 one starts, as on a host that ran 0.2.0, which knew no units.
 */
async function endCore(run: SoakRun): Promise<void> {
    const host = run.host;
    const root = `$HOME/${run.root}`;
    const unit = `"trcd-$(printf %s "${root}" | sha256sum | cut -c1-8).service"`;
    ssh(
        run.alias,
        `systemctl --user stop ${unit} 2>/dev/null; kill -KILL $(head -n 1 ${root}/run/core.lock) 2>/dev/null; true`,
    );
    await ended(host);
}

/** The version the host's daemon reported when the connection came up. */
function versionOf(host: SoakRun['host']): string | undefined {
    const state = host.states.at(-1);
    return state?.status === 'connected' ? state.daemon.version : undefined;
}

/** Kills the running core, lets a 0.2.0 core take the sessions, then connects with this build, which replaces it. */
async function upgrade(run: SoakRun, cycle: number): Promise<SoakRun['host']> {
    await endCore(run);
    run.away(cycle);
    const old = await run.connect({ daemons: OLD_DAEMONS, timed: false });
    expect(versionOf(old)).toBe('0.2.0');
    old.connection.close();
    const upgraded = await run.connect();
    expect(versionOf(upgraded)).not.toBe('0.2.0');
    return upgraded;
}

describe.skipIf(testHostsMissing() !== undefined)('soak: the daemon dies (NFR-11, US-2.5.2)', () => {
    it.each([
        ['trc-ubuntu', 'detached'],
        ['trc-systemd-linger', 'under systemd with lingering'],
    ])('kills the core on %s, %s, and every session stays', async (alias, how) => {
        const run = new SoakRun(alias);
        runs.push(run);
        await run.start(3);
        await run.soak(CYCLES, (_, cycle) => killCore(run, cycle));
        run.report(`daemon kill, ${how}`, CYCLES);
    });
});

describe.skipIf(testHostsMissing() !== undefined || oldMissing !== undefined)(
    'soak: daemon upgrades (NFR-11, US-2.5.3)',
    () => {
        it.each([
            ['trc-ubuntu', 'detached'],
            ['trc-systemd-linger', 'under systemd with lingering'],
        ])('replaces a 0.2.0 core with this build’s on %s, %s, and every session stays', async (alias, how) => {
            const run = new SoakRun(alias);
            runs.push(run);
            await run.start(3, { daemons: OLD_DAEMONS });
            await run.soak(CYCLES, (_, cycle) => upgrade(run, cycle));
            run.report(`daemon upgrade 0.2.0 to this build, ${how}`, CYCLES);
        });
    },
);
