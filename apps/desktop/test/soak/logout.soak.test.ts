import { afterEach, describe, expect, it } from 'vitest';
import { testHostsMissing } from '../nfr/live-host';
import { corePid, onHost, SoakRun, soakCycles } from './soak';

/**
 * Logging out with lingering off and `KillUserProcesses=no` (S6, US-2.4.3): every connection closes, so logind reports
 * every login of the user closing, and the next connection comes only past `UserStopDelaySec` (10 s); the daemon, which
 * runs detached in the login session's scope, must keep every session. It holds that scope, so the user stays
 * `closing` and systemd keeps their manager running, as with tmux (S11). 50 cycles.
 */
const CYCLES = soakCycles('TRC_SOAK_LOGOUT_CYCLES', 50);
/** The host without lingering and with `KillUserProcesses=no` (P-32). */
const HOST = 'trc-systemd';
const runs: SoakRun[] = [];
afterEach(() => {
    for (const run of runs.splice(0)) {
        run.remove();
    }
});

describe.skipIf(testHostsMissing() !== undefined)('soak: logout without lingering (S6, US-2.4.3)', () => {
    it('closes every connection past UserStopDelaySec, and every session stays', async () => {
        const run = new SoakRun(HOST);
        runs.push(run);
        await run.start(3);
        expect(detachedCore(run)).toBe(true);
        await run.soak(CYCLES, async (_, cycle) => {
            run.host.connection.close();
            await loggedOut();
            run.away(cycle);
            return run.connect();
        });
        run.report('logout without lingering (KillUserProcesses=no)', CYCLES);
    });
});

/** How long the user's last login session may take to end once its connection closed. */
const LOGOUT_MS = 20_000;
/** Then past `UserStopDelaySec` (10 s), when systemd would stop anything that depended on the user's logins. */
const PAST_STOP_DELAY_MS = 12_000;

/**
 * Waits until the test user has logged out, so every login session of theirs is closing, then past
 * `UserStopDelaySec`. The detached daemon's processes keep the user's state `closing`, as tmux's do, so systemd keeps
 * their manager until those processes end.
 */
async function loggedOut(): Promise<void> {
    const deadline = Date.now() + LOGOUT_MS;
    while (userState() !== 'closing') {
        if (Date.now() > deadline) {
            throw new Error(`the test user is still ${userState()} ${LOGOUT_MS} ms after the last connection closed`);
        }
        await new Promise((done) => setTimeout(done, 500));
    }
    await new Promise((done) => setTimeout(done, PAST_STOP_DELAY_MS));
}

/** The test user's logind state on the host. */
function userState(): string {
    return onHost(HOST, ['sh', '-c', 'loginctl show-user tester -p State --value 2>/dev/null || echo none']).trim();
}

/** Whether the run's core runs detached, in a login session's scope, rather than in the user's systemd manager. */
function detachedCore(run: SoakRun): boolean {
    const state = run.host.states.at(-1);
    const cgroup = onHost(HOST, ['cat', `/proc/${corePid(run)}/cgroup`]);
    const manager = state?.status === 'connected' ? state.daemon.service?.manager : undefined;
    return manager === 'detached' && /session-\d+\.scope/.test(cgroup) && !cgroup.includes('user@');
}
