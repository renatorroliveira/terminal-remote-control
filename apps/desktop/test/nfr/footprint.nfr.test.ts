import { afterAll, describe, expect, it } from 'vitest';
import {
    closeLiveHosts,
    connectLive,
    type LiveHost,
    type LiveSession,
    ssh,
    testHostsMissing,
    waitFor,
} from './live-host';
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

/** Forgets a process's peak resident memory, so the next peak is measured from now, and returns its memory in MiB. */
function resetPeak(host: LiveHost, pid: number): number {
    const status = ssh(host.alias, `echo 5 > /proc/${pid}/clear_refs && grep VmRSS /proc/${pid}/status`);
    return Number(/(\d+) kB/.exec(status)?.[1]) / 1024;
}

/** A process's peak resident memory since its last reset, in MiB. */
function peakMiB(host: LiveHost, pid: number): number {
    return Number(/(\d+) kB/.exec(ssh(host.alias, `grep VmHWM /proc/${pid}/status`))?.[1]) / 1024;
}

/** A new session with a known prompt, and its holder's pid. */
async function readySession(
    host: LiveHost,
    scrollbackLines: number | undefined,
): Promise<{ readonly session: LiveSession; readonly holder: number }> {
    const session = await host.session(scrollbackLines === undefined ? {} : { scrollbackLines });
    session.type('PS1="trc-ready$ "\r');
    await session.next('trc-ready$ ');
    return { session, holder: pids(host, 'holder').at(-1) ?? 0 };
}

/** Prints `lines` numbered lines in the session and waits until they are all out. */
async function printSeq(session: LiveSession, lines: number): Promise<void> {
    const done = session.next('TRC-SEQ-DONE', 120_000);
    session.type(`seq 1 ${lines}; echo TRC-SEQ-""DONE\r`);
    await done;
}

async function printLines(
    host: LiveHost,
    scrollbackLines: number | undefined,
    lines: number,
): Promise<readonly number[]> {
    const { session, holder } = await readySession(host, scrollbackLines);
    const sizes: number[] = [];
    for (let round = 0; round < 3; round += 1) {
        await printSeq(session, lines);
        sizes.push(rssMiB(host, holder));
    }
    return sizes;
}

/**
 * How much a full holder grows at its peak while a second client attaches it from the start, and its size before, in
 * MiB: the snapshot streams within the client's credit (S12), and while a full-screen program runs it streams from a
 * copy of the session's primary screen and scrollback (P-37).
 */
async function attachGrowth(
    scrollbackLines: number | undefined,
    lines: number,
    fullScreen: boolean,
): Promise<{ readonly growth: number; readonly before: number }> {
    const host = await connectLive('trc-ubuntu');
    const { session, holder } = await readySession(host, scrollbackLines);
    await printSeq(session, lines);
    if (fullScreen) {
        const entered = session.next('TRC-ALT-ON');
        session.type(`printf '\\033[?1049h'; echo TRC-ALT-""ON; cat\r`);
        await entered;
    }
    const before = resetPeak(host, holder);
    const second = await connectLive('trc-ubuntu', { root: host.root });
    const attached = await second.attach(session.id);
    await waitFor(() => second.offsetOf(attached.stream) !== undefined, 120_000);
    return { growth: peakMiB(host, holder) - before, before };
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

describe.skipIf(missing !== undefined)('a second client attaching a full session (NFR-09, S12)', () => {
    it('streams the snapshot of a full holder at the 100,000-line maximum within 10 MB of growth', async () => {
        const { growth } = await attachGrowth(100_000, 150_000, false);
        recordGrowth('the 100,000-line maximum', growth);
        expect(growth).toBeLessThanOrEqual(10);
    }, 600_000);

    it.each([
        ['the 100,000-line maximum, a full-screen program running', 100_000, 150_000],
        ['the default 10,000 lines, a full-screen program running', undefined, 20_000],
    ] as const)(
        'measures the copy a snapshot streams from with %s, an E2 exception to NFR-09 bounded by one copy',
        async (label, scrollbackLines, lines) => {
            const { growth, before } = await attachGrowth(scrollbackLines, lines, true);
            recordGrowth(label, growth);
            expect(growth).toBeLessThanOrEqual(before);
        },
        600_000,
    );
});

/** Records how much a holder grew while a second client attached it from the start. */
function recordGrowth(label: string, growth: number): void {
    record({
        id: 'NFR-09',
        what: `holder with ${label}: peak growth while a second client attaches from the start`,
        value: growth,
        unit: 'MiB',
        target: '≤ 10 MB',
    });
}
