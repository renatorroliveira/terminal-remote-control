import { afterAll, describe, expect, it } from 'vitest';
import { closeLiveHosts, connectLive, type LiveHost, ssh, testHostsMissing } from './live-host';
import { record } from './stats';

const missing = testHostsMissing();
const IDLE_SECONDS = 10;
const IDLE_SESSIONS = 10;

afterAll(() => closeLiveHosts());

/** The pids of the daemon's `role` processes (core or holder) under this host's install. */
function pids(host: LiveHost, role: 'core' | 'holder'): readonly number[] {
    const out = ssh(host.alias, `pgrep -u "$(id -u)" -f "/${host.root}/versions/.*/[t]rcd ${role}" || true`);
    return out
        .split('\n')
        .filter((line) => /^\d+$/.test(line.trim()))
        .map(Number);
}

/** Resident memory in MiB, from `ps`. */
function rssMiB(host: LiveHost, pid: number): number {
    return Number(ssh(host.alias, `ps -o rss= -p ${pid}`).trim()) / 1024;
}

/** CPU time a process used over `seconds`, as a share of one core, in percent. */
function cpuPercent(host: LiveHost, pid: number, seconds: number): number {
    const script = `t() { awk '{print $14 + $15}' /proc/${pid}/stat; }; a=$(t); sleep ${seconds}; b=$(t); echo "$a $b $(getconf CLK_TCK)"`;
    const [before = 0, after = 0, ticks = 100] = ssh(host.alias, script).trim().split(' ').map(Number);
    return ((after - before) / ticks / seconds) * 100;
}

async function printLines(
    host: LiveHost,
    scrollbackLines: number | undefined,
    lines: number,
): Promise<readonly number[]> {
    const session = await host.session(scrollbackLines === undefined ? {} : { scrollbackLines });
    session.type('PS1="trc-ready$ "\r');
    await session.next('trc-ready$ ');
    const holder = pids(host, 'holder').at(-1) ?? 0;
    const sizes: number[] = [];
    for (let round = 0; round < 3; round += 1) {
        const done = session.next('TRC-SEQ-DONE', 120_000);
        session.type(`seq 1 ${lines}; echo TRC-SEQ-""DONE\r`);
        await done;
        sizes.push(rssMiB(host, holder));
    }
    return sizes;
}

describe.skipIf(missing !== undefined)('daemon footprint (NFR-09)', () => {
    it('idles under 30 MB and 0.5% CPU, with under 10 MB per session', async () => {
        const host = await connectLive('trc-ubuntu');
        const [core = 0] = pids(host, 'core');
        await new Promise((done) => setTimeout(done, 3_000));
        const idleRss = rssMiB(host, core);
        const idleCpu = cpuPercent(host, core, IDLE_SECONDS);
        for (let index = 0; index < IDLE_SESSIONS; index += 1) {
            await host.session();
        }
        await new Promise((done) => setTimeout(done, 2_000));
        const holders = pids(host, 'holder').map((pid) => rssMiB(host, pid));
        const coreWithSessions = rssMiB(host, core);
        const perSession = Math.max(...holders) + (coreWithSessions - idleRss) / IDLE_SESSIONS;
        record({
            id: 'NFR-09',
            what: 'idle core, no sessions: resident memory',
            value: idleRss,
            unit: 'MiB',
            target: '≤ 30 MB',
        });
        record({
            id: 'NFR-09',
            what: `idle core: CPU over ${IDLE_SECONDS} s`,
            value: idleCpu,
            unit: '%',
            target: '≤ 0.5%',
        });
        record({
            id: 'NFR-09',
            what: `per session (largest holder plus the core's growth), ${IDLE_SESSIONS} idle sessions`,
            value: perSession,
            unit: 'MiB',
            target: '≤ 10 MB',
        });
        expect(idleRss).toBeLessThanOrEqual(30);
        expect(idleCpu).toBeLessThanOrEqual(0.5);
        expect(perSession).toBeLessThanOrEqual(10);
    }, 300_000);
});

describe.skipIf(missing !== undefined)('scrollback memory (NFR-10)', () => {
    it.each([
        ['the default 10,000 lines', undefined, 20_000],
        ['the 100,000-line maximum', 100_000, 150_000],
    ] as const)(
        'keeps a holder bounded with %s',
        async (label, scrollbackLines, lines) => {
            const host = await connectLive('trc-ubuntu');
            const sizes = await printLines(host, scrollbackLines, lines);
            const [first = 0, , last = 0] = sizes;
            record({ id: 'NFR-10', what: `holder with ${label}, full`, value: last, unit: 'MiB', target: 'bounded' });
            record({
                id: 'NFR-10',
                what: `holder with ${label}: growth after ${2 * lines} more lines`,
                value: last - first,
                unit: 'MiB',
                target: '≈ 0',
            });
            expect(last - first).toBeLessThanOrEqual(Math.max(2, first * 0.1));
        },
        600_000,
    );
});
