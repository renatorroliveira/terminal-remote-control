import type { SessionInfo } from '@trc/protocol';
import { afterAll, describe, expect, it } from 'vitest';
import {
    closeLiveHosts,
    connectLive,
    type LiveHost,
    reconnectLive,
    restartTestHost,
    ssh,
    testHostsMissing,
    waitFor,
} from './live-host';
import { record } from './stats';

const HOST = 'trc-ubuntu';
const SESSIONS = 100;
let nextRequest = 600_000;

afterAll(() => closeLiveHosts());

async function listed(host: LiveHost): Promise<readonly SessionInfo[]> {
    const requestId = nextRequest++;
    const { message } = await host.request(
        { type: 'listSessions', requestId },
        'sessions',
        (reply) => reply.requestId === requestId,
    );
    return message.sessions;
}

/**
 * How many sessions under `root` have their record on disk, with no write still in flight: the core syncs each one
 * from a queue, which a slow disk such as Docker Desktop's drains over a few seconds, within NFR-08's 5 s.
 */
function recordsOnDisk(root: string): number {
    const script = `ls ~/${root}/sessions/*/meta.json.new >/dev/null 2>&1 && echo 0 || ls ~/${root}/sessions/*/meta.json | wc -l`;
    return Number(ssh(HOST, script).trim());
}

/** Waits until every listed session runs and `wanted` holds for each, polling the daemon's list. */
async function allRunning(host: LiveHost, wanted: (session: SessionInfo) => boolean): Promise<void> {
    const deadline = performance.now() + 300_000;
    for (;;) {
        const sessions = await listed(host);
        if (sessions.length === SESSIONS && sessions.every((s) => s.state === 'running' && wanted(s))) {
            return;
        }
        if (performance.now() > deadline) {
            const stopped = sessions.filter((s) => s.state !== 'running').length;
            const unwanted = sessions.filter((s) => !wanted(s)).length;
            throw new Error(
                `${sessions.length} sessions listed, ${stopped} not running, ${unwanted} not yet as wanted, such as ${JSON.stringify(sessions.find((s) => !wanted(s)))}`,
            );
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
}

describe.skipIf(testHostsMissing() !== undefined)('restore at scale (US-3.1, NFR-05)', () => {
    it(`brings back ${SESSIONS} sessions at once after the host restarts, each taking input`, async () => {
        let host = await connectLive(HOST);
        const root = host.root;
        for (let index = 0; index < SESSIONS; index += 1) {
            await host.session({ env: { PS1: '$ ' } });
        }
        await allRunning(host, () => true);
        await waitFor(() => recordsOnDisk(root) === SESSIONS, 30_000);
        host.connection.close();
        restartTestHost(HOST);
        const restarted = performance.now();
        host = await reconnectLive(HOST, root);
        const connected = performance.now();
        await allRunning(host, (session) => session.restored !== undefined);
        const restored = performance.now();
        const ids = (await listed(host)).map((session) => session.id);
        for (const id of [ids[0], ids[SESSIONS - 1]]) {
            const session = await host.attach(id ?? '');
            const echoed = session.next('restore-at-scale-ok', 15_000);
            session.type("echo restore-at-scale-o''k\r");
            await echoed;
        }
        record({
            id: 'NFR-05',
            what: `${HOST}: connected after a host restart to all ${SESSIONS} sessions restored and running`,
            value: (restored - connected) / 1_000,
            unit: 's',
            target: '—',
        });
        record({
            id: 'NFR-05',
            what: `${HOST}: host restart to all ${SESSIONS} sessions restored and running`,
            value: (restored - restarted) / 1_000,
            unit: 's',
            target: '—',
        });
        expect(ids).toHaveLength(SESSIONS);
    }, 600_000);
});
