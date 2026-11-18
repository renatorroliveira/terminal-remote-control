import { execFileSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { MAC_HOST_UP } from './mac-hosts';
import { type LiveHost, ssh, testHostsMissing } from './nfr/live-host';
import { ended, SoakRun } from './soak/soak';

/**
 * A logout of a Mac's GUI user ends no session (US-4.4.2, P-62, S8): it unloads the user's launchd domain, and the
 * LaunchAgent's core with it, but every holder called `setsid()`, so its shell keeps running; the next connection's
 * core, detached as the user has no GUI login now, adopts every session with its output and input. The VM then
 * reboots, so its user logs in again for the other suites.
 */
const HOST = 'trc-mac-gui';
const run = new SoakRun(HOST);
const LOGOUT_MS = 60_000;
const REBOOT_MS = 240_000;

afterAll(() => {
    run.remove();
    reboot();
}, REBOOT_MS + 30_000);

/** What runs the daemon of a connection that came up. */
function managerOf(host: LiveHost): string | undefined {
    const state = host.states.at(-1);
    return state?.status === 'connected' ? state.daemon.service?.manager : undefined;
}

/** Whether the host's user has a GUI login session now, or `undefined` while the host does not answer. */
function guiSession(): boolean | undefined {
    try {
        return ssh(HOST, 'launchctl print gui/$(id -u) >/dev/null 2>&1 && echo gui || echo none').trim() === 'gui';
    } catch {
        return undefined;
    }
}

/** Polls `condition` every second until it holds, or throws after `timeoutMs`. */
function pollUntil(condition: () => boolean, timeoutMs: number, what: string): void {
    const started = Date.now();
    while (!condition()) {
        if (Date.now() - started > timeoutMs) {
            throw new Error(`${HOST}: ${what} within ${timeoutMs} ms`);
        }
        execFileSync('sleep', ['1']);
    }
}

/** Logs the GUI user out as loginwindow's "really log out" does, and connects again once the domain is gone. */
async function logOut(cycle: number): Promise<LiveHost> {
    const host = run.host;
    const event = `osascript -e 'tell application "loginwindow" to «event aevtrlgo»'`;
    ssh(HOST, `sudo launchctl asuser $(id -u) sudo -u $(id -un) ${event} >/dev/null 2>&1; true`);
    pollUntil(() => guiSession() === false, LOGOUT_MS, 'the GUI login did not end');
    await ended(host);
    run.away(cycle);
    const next = await run.connect();
    expect(managerOf(next), 'without a GUI login the core runs detached (P-61)').toBe('detached');
    return next;
}

/** Reboots the VM, whose image logs its user in again at boot, and waits for that login. */
function reboot(): void {
    try {
        ssh(HOST, '(sleep 1; sudo shutdown -r now) >/dev/null 2>&1 &');
    } catch {
        return;
    }
    execFileSync('sleep', ['15']);
    pollUntil(() => guiSession() === true, REBOOT_MS, 'the GUI login did not come back after a reboot');
}

describe.skipIf(!MAC_HOST_UP || testHostsMissing() !== undefined)('a logout on a Mac (US-4.4.2, P-62)', () => {
    it('ends no session: the next core adopts every shell, with its output and its input', async () => {
        await run.start(2);
        expect(managerOf(run.host)).toBe('launchd');
        await run.soak(1, (_, cycle) => logOut(cycle));
    }, 180_000);
});
