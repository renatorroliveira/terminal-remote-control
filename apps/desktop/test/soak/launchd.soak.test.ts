import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { MAC_HOST_UP } from '../mac-hosts';
import { LOCAL_ALIAS, removeLocalHome, ssh, testHostsMissing } from '../nfr/live-host';
import { CYCLES, corePid, ended, SoakRun } from './soak';

/**
 * Daemon kills and upgrades under launchd, 1,000 times each (NFR-11, US-4.3, US-2.5): the LaunchAgent's core dies,
 * or an older core gives way to this build's, on This computer, whose temporary agent lives in a scratch home (P-58),
 * and on the macOS test host's GUI user; every session keeps its shell.
 */
const runs: SoakRun[] = [];
afterEach(() => {
    for (const run of runs.splice(0)) {
        run.remove();
    }
});
afterAll(removeLocalHome);

const daemon = resolve(import.meta.dirname, '../../resources/daemon/darwin-universal/trcd');
const localMissing = process.platform !== 'darwin' || !existsSync(daemon) || testHostsMissing() !== undefined;
const HOSTS: readonly string[] = [
    ...(localMissing ? [] : [LOCAL_ALIAS]),
    ...(MAC_HOST_UP && !localMissing ? ['trc-mac-gui'] : []),
].filter((alias) => (process.env['TRC_SOAK_HOST'] ?? alias) === alias);

/** The version the daemon reported when the connection came up, and whether launchd runs it. */
function underLaunchd(host: SoakRun['host']): { readonly version?: string; readonly launchd: boolean } {
    const state = host.states.at(-1);
    if (state?.status !== 'connected') {
        return { launchd: false };
    }
    return { version: state.daemon.version, launchd: state.daemon.service?.manager === 'launchd' };
}

/** Kills the LaunchAgent's core with SIGKILL and connects again, so the next core adopts every holder. */
async function killCore(run: SoakRun, cycle: number): Promise<SoakRun['host']> {
    const host = run.host;
    ssh(run.alias, `kill -KILL ${corePid(run)}`);
    await ended(host);
    run.away(cycle);
    const next = await run.connect();
    expect(underLaunchd(next).launchd, `cycle ${cycle}: the core runs under launchd`).toBe(true);
    return next;
}

/**
 * Has the running core report an older version in its lock, written in place as the core holds it, so the next
 * connection's bridge upgrades it: it boots the agent out, writes its plist again and bootstraps it (US-2.5.3).
 */
async function upgrade(run: SoakRun, cycle: number): Promise<SoakRun['host']> {
    const host = run.host;
    const before = corePid(run);
    const lock = `$HOME/${run.root}/run/core.lock`;
    ssh(run.alias, `text=$(awk 'NR == 2 { $0 = "0.0.1" } 1' ${lock}) && printf '%s\\n' "$text" > ${lock}`);
    const next = await run.connect();
    await ended(host);
    run.away(cycle);
    const after = underLaunchd(next);
    expect(after.launchd, `cycle ${cycle}: the upgraded core runs under launchd`).toBe(true);
    expect(after.version, `cycle ${cycle}: the upgraded core's version`).not.toBe('0.0.1');
    expect(corePid(run), `cycle ${cycle}: a new core took over`).not.toBe(before);
    return next;
}

describe.skipIf(HOSTS.length === 0)('soak: the LaunchAgent core dies (NFR-11, US-4.3)', () => {
    it.each(HOSTS)('kills the core on %s under launchd, and every session stays', async (alias) => {
        const run = new SoakRun(alias);
        runs.push(run);
        await run.start(3);
        expect(underLaunchd(run.host).launchd).toBe(true);
        await run.soak(CYCLES, (_, cycle) => killCore(run, cycle));
        run.report('daemon kill, LaunchAgent', CYCLES);
    });
});

describe.skipIf(HOSTS.length === 0)('soak: LaunchAgent upgrades (NFR-11, US-4.3, US-2.5.3)', () => {
    it.each(HOSTS)(
        'replaces an older core with this build’s on %s under launchd, and every session stays',
        async (alias) => {
            const run = new SoakRun(alias);
            runs.push(run);
            await run.start(3);
            await run.soak(CYCLES, (_, cycle) => upgrade(run, cycle));
            run.report('daemon upgrade, LaunchAgent', CYCLES);
        },
    );
});
