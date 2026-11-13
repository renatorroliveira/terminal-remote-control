import { CREDIT_WINDOW } from '@trc/protocol';
import { afterAll, describe, expect, it } from 'vitest';
import { closeLiveHosts, connectLive, type LiveSession, ssh, sshRoundTrip, testHostsMissing } from './live-host';
import { percentile, record } from './stats';

const missing = testHostsMissing();
const ECHO_SAMPLES = 60;
const INTERRUPT_SAMPLES = 15;
const FLOOD = [
    'import os, signal, sys',
    'def stop(*_):',
    '    os.write(1, b"\\nTRC-INT-" + b"DONE\\n"); os._exit(0)',
    'signal.signal(signal.SIGINT, stop)',
    'line = "y" * 79 + "\\n"',
    'while True: sys.stdout.write(line)',
].join('\n');

afterAll(() => closeLiveHosts());

async function prompt(session: LiveSession): Promise<void> {
    session.type('PS1="trc-ready$ "\r');
    await session.next('trc-ready$ ');
}

/** Times each typed letter until its echo arrives, then clears the line. */
async function echoTimes(session: LiveSession, samples: number): Promise<readonly number[]> {
    const times: number[] = [];
    for (let index = 0; index < samples; index += 1) {
        const letter = String.fromCharCode(97 + (index % 26));
        const arrived = session.next(letter);
        const sent = performance.now();
        session.type(letter);
        times.push((await arrived) - sent);
        if (index % 20 === 19) {
            session.type('\u0015');
            await new Promise((done) => setTimeout(done, 50));
        }
        await new Promise((done) => setTimeout(done, 20));
    }
    session.type('\u0015');
    return times;
}

describe.skipIf(missing !== undefined)('input latency over the connection (NFR-02)', () => {
    it.each(['trc-ubuntu', 'trc-latency'])(
        'echoes typing on %s within the SSH round trip plus 10 ms, p95',
        async (alias) => {
            const host = await connectLive(alias);
            const session = await host.session();
            await prompt(session);
            const rtt = await sshRoundTrip(host);
            const p95 = percentile(await echoTimes(session, ECHO_SAMPLES), 95);
            record({
                id: 'NFR-02',
                what: `${alias}: SSH round trip, ping to pong over the channel (median)`,
                value: rtt,
                unit: 'ms',
                target: '—',
            });
            record({
                id: 'NFR-02',
                what: `${alias}: keystroke to echo at the connection host, p95`,
                value: p95,
                unit: 'ms',
                target: `≤ ${(rtt + 10).toFixed(1)} ms`,
            });
            expect(p95).toBeLessThanOrEqual(rtt + 10);
        },
        180_000,
    );
});

describe.skipIf(missing !== undefined)('interrupt under sustained output (NFR-03)', () => {
    it('delivers Ctrl+C to a program flooding the terminal, p95 ≤ 100 ms', async () => {
        const host = await connectLive('trc-ubuntu');
        const session = await host.session();
        await prompt(session);
        ssh('trc-ubuntu', `echo ${Buffer.from(FLOOD).toString('base64')} | base64 -d > /tmp/trc-flood.py`);
        const times: number[] = [];
        for (let index = 0; index < INTERRUPT_SAMPLES; index += 1) {
            session.type('python3 /tmp/trc-flood.py\r');
            const flooding = session.received();
            await waitBytes(session, flooding + 4 * 1024 * 1024);
            const stopped = session.next('TRC-INT-DONE', 10_000);
            const ready = session.next('trc-ready$ ', 10_000);
            const sent = performance.now();
            session.type('\u0003');
            times.push((await stopped) - sent);
            await ready;
        }
        const p95 = percentile(times, 95);
        record({
            id: 'NFR-03',
            what: 'trc-ubuntu: Ctrl+C under `python3` flood until the program reports it, p95',
            value: p95,
            unit: 'ms',
            target: '≤ 100 ms',
        });
        expect(p95).toBeLessThanOrEqual(100);
    }, 180_000);
});

describe.skipIf(missing !== undefined)('throughput with the credit window (S3b, P-16)', () => {
    it.each(['trc-ubuntu', 'trc-latency'])(
        'streams 32 MB of output on %s and records the rate',
        async (alias) => {
            const host = await connectLive(alias);
            const session = await host.session();
            await prompt(session);
            const done = session.next('TRC-STREAM-DONE', 300_000);
            const before = session.received();
            const started = performance.now();
            session.type('yes trc-throughput-line | head -c 33554432; echo; echo TRC-STREAM-""DONE\r');
            const seconds = ((await done) - started) / 1_000;
            const megabytes = (session.received() - before) / 1024 / 1024;
            record({
                id: 'S3b',
                what: `${alias}: output rate with a ${CREDIT_WINDOW / 1024} KiB credit window`,
                value: megabytes / seconds,
                unit: 'MiB/s',
                target: '—',
            });
            expect(megabytes).toBeGreaterThanOrEqual(32);
        },
        330_000,
    );
});

async function waitBytes(session: LiveSession, bytes: number): Promise<void> {
    const deadline = Date.now() + 30_000;
    while (session.received() < bytes) {
        if (Date.now() > deadline) {
            throw new Error('the flood did not start');
        }
        await new Promise((done) => setTimeout(done, 10));
    }
}
