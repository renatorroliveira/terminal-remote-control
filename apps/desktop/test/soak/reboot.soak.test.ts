import { execFileSync } from 'node:child_process';
import type { SessionInfo } from '@trc/protocol';
import { afterAll, describe, expect, it } from 'vitest';
import { closeLiveHosts, connectLive, type LiveHost, ssh, testHostsMissing, waitFor } from '../nfr/live-host';
import { percentile, record } from '../nfr/stats';
import { soakCycles } from './soak';

/** How many restarts the reboot soak runs (ST-49's 100 unless `TRC_SOAK_REBOOT_CYCLES` says otherwise). */
const CYCLES = soakCycles('TRC_SOAK_REBOOT_CYCLES', 100);
const HOST = 'trc-ubuntu';
const SESSIONS = 3;
const MARKER = /Session restored (after restart )?on \d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC\. Previous processes ended\./g;

afterAll(() => {
    closeLiveHosts();
});

/** Restarts the test host's container, which ends every process in it as a reboot does (P-50). */
function restartHost(): void {
    const context = process.env['DOCKER_CONTEXT'] ?? 'colima-trc';
    execFileSync('docker', ['--context', context, 'restart', '--time', '1', 'trc-test-hosts-ubuntu-1'], {
        stdio: 'ignore',
        timeout: 60_000,
    });
}

/** Connects to the run's install root again, retrying while the restarted host's sshd comes up. */
async function reconnect(root: string): Promise<LiveHost> {
    const started = performance.now();
    for (;;) {
        try {
            return await connectLive(HOST, { root });
        } catch (error) {
            if (performance.now() - started > 60_000) {
                throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
    }
}

async function listed(host: LiveHost): Promise<readonly SessionInfo[]> {
    const { message } = await host.request({ type: 'listSessions', requestId: 70_000 }, 'sessions');
    return message.sessions;
}

/** Prints the cycle's marker in every session and waits until each session's scrollback file holds it. */
async function printSaved(host: LiveHost, ids: readonly string[], cycle: number): Promise<void> {
    for (const [index, id] of ids.entries()) {
        const session = await host.attach(id);
        const marker = `boot-${cycle}-${index}-ok`;
        const echoed = session.next(marker, 15_000);
        session.type(`echo boot-${cycle}-${index}-o''k\r`);
        await echoed;
        const file = `$HOME/${host.root}/sessions/${id}/scrollback.log`;
        await waitFor(() => ssh(HOST, `grep -c ${marker} ${file} || true`).trim().endsWith('1'), 15_000);
    }
}

/** The session as the daemon lists it once it runs again, waiting up to 30 s for its restored shell to start. */
async function runningAgain(host: LiveHost, id: string, cycle: number): Promise<SessionInfo> {
    for (let attempt = 0; attempt < 60; attempt += 1) {
        const info = (await listed(host)).find((session) => session.id === id);
        if (info?.state === 'running') {
            return info;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`cycle ${cycle}: session ${id} does not run again`);
}

/** Checks that a session shows its cycle's marker once, with a restore marker below it, and takes input. */
async function checkScrollback(host: LiveHost, id: string, cycle: number, index: number): Promise<void> {
    const marker = `boot-${cycle}-${index}-ok`;
    const session = await host.attach(id);
    await waitFor(() => session.tail().includes(marker), 15_000);
    const tail = session.tail();
    const printed = tail.split(`\n${marker}`).length - 1;
    if (printed !== 1) {
        throw new Error(`cycle ${cycle}: session ${id} shows its marker ${printed} times`);
    }
    if (tail.slice(tail.lastIndexOf(marker)).match(MARKER) === null) {
        throw new Error(`cycle ${cycle}: session ${id} has no restore marker below its saved output`);
    }
    const echoed = session.next(`after-${cycle}-${index}-ok`, 15_000);
    session.type(`echo after-${cycle}-${index}-o''k\r`);
    await echoed;
}

/** Checks every session came back once in this cycle, running, below its saved marker, and takes input. */
async function checkRestored(host: LiveHost, ids: readonly string[], cycle: number, before: Map<string, number>) {
    for (const [index, id] of ids.entries()) {
        const info = await runningAgain(host, id, cycle);
        const restoredAt = info.restored?.at;
        if (restoredAt === undefined || restoredAt === before.get(id)) {
            throw new Error(`cycle ${cycle}: session ${id} was not restored this cycle: ${JSON.stringify(info)}`);
        }
        before.set(id, restoredAt);
        await checkScrollback(host, id, cycle, index);
    }
}

describe.skipIf(testHostsMissing() !== undefined)('soak: the host restarts (US-3.1, ST-49)', () => {
    it(`restores every session exactly once with its saved output, ${CYCLES} times`, async () => {
        let host = await connectLive(HOST);
        const root = host.root;
        const ids: string[] = [];
        for (let index = 0; index < SESSIONS; index += 1) {
            ids.push((await host.session({ env: { PS1: '$ ' } })).id);
        }
        const restoredAt = new Map<string, number>();
        const back: number[] = [];
        for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
            await printSaved(host, ids, cycle);
            host.connection.close();
            restartHost();
            const restarted = performance.now();
            host = await reconnect(root);
            await checkRestored(host, ids, cycle, restoredAt);
            back.push(performance.now() - restarted);
        }
        record({
            id: 'US-3.1',
            what: `${HOST}: sessions lost or restored twice in ${CYCLES} restarts`,
            value: 0,
            unit: '',
            target: '0',
        });
        record({
            id: 'US-3.1',
            what: `${HOST}: host restart to every session restored and taking input, p95 of ${CYCLES}`,
            value: percentile(back, 95) / 1_000,
            unit: 's',
            target: '—',
        });
        expect(back).toHaveLength(CYCLES);
    });
});
