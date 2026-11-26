import { execFileSync } from 'node:child_process';
import { CREDIT_WINDOW } from '@trc/protocol';
import { afterAll, describe, expect, it } from 'vitest';
import { dockerContextArguments } from '../test-platform';
import { ECHO_ALLOWANCE_MS, ECHO_PERCENTILE, ECHO_SAMPLES } from './echo-target';
import {
    closeLiveHosts,
    connectLive,
    type LiveSession,
    ssh,
    sshRoundTrip,
    testHostsMissing,
    waitFor,
} from './live-host';
import { percentile, record } from './stats';

const missing = testHostsMissing();
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
        'echoes typing on %s within the SSH round trip plus a frame, p99',
        async (alias) => {
            const host = await connectLive(alias);
            const session = await host.session();
            await prompt(session);
            const rtt = await sshRoundTrip(host);
            const p99 = percentile(await echoTimes(session, ECHO_SAMPLES), ECHO_PERCENTILE);
            record({
                id: 'NFR-02',
                what: `${alias}: SSH round trip, ping to pong over the channel (median)`,
                value: rtt,
                unit: 'ms',
                target: '—',
            });
            record({
                id: 'NFR-02',
                what: `${alias}: keystroke to echo at the connection host, p${ECHO_PERCENTILE}`,
                value: p99,
                unit: 'ms',
                target: `≤ ${(rtt + ECHO_ALLOWANCE_MS).toFixed(1)} ms`,
            });
            expect(p99).toBeLessThanOrEqual(rtt + ECHO_ALLOWANCE_MS);
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

describe.skipIf(missing !== undefined)('throughput with the credit window (S3b, D-04)', () => {
    it.each(['trc-ubuntu', 'trc-latency'])(
        'floods 32 MB of output on %s without blocking the program, and records the rate the app received',
        async (alias) => {
            const host = await connectLive(alias);
            const session = await host.session();
            await prompt(session);
            const done = session.next('TRC-STREAM-DONE', 300_000);
            const before = session.received();
            const started = performance.now();
            const timed = 's=$(date +%s%N); yes trc-throughput-line | head -c 33554432; e=$(date +%s%N)';
            session.type(`${timed}; echo; echo TRC-STREAM-""DONE-$(( (e - s) / 1000000 ))-ms\r`);
            const seconds = ((await done) - started) / 1_000;
            const megabytes = (session.received() - before) / 1024 / 1024;
            await waitFor(() => /TRC-STREAM-DONE-\d+-ms/.test(session.tail()));
            const programMs = Number(/TRC-STREAM-DONE-(\d+)-ms/.exec(session.tail())?.[1]);
            record({
                id: 'S3b',
                what: `${alias}: output the app received under a 32 MiB flood, ${CREDIT_WINDOW / 1024} KiB credit window`,
                value: megabytes / seconds,
                unit: 'MiB/s',
                target: '—',
            });
            record({
                id: 'S3b',
                what: `${alias}: time the program took to write the 32 MiB flood`,
                value: programMs,
                unit: 'ms',
                target: 'never blocked (≤ 5,000 ms)',
            });
            expect(megabytes).toBeGreaterThan(0);
            expect(programMs).toBeLessThanOrEqual(5_000);
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

describe.skipIf(missing !== undefined)('dead connection detection (NFR-07)', () => {
    it('notices a host that stopped answering within 30 s', async () => {
        const host = await connectLive('trc-rocky');
        const docker = dockerContextArguments();
        execFileSync('docker', [...docker, 'pause', 'trc-test-hosts-rocky-1'], { windowsHide: true });
        try {
            const started = performance.now();
            await waitFor(() => host.states.at(-1)?.status === 'disconnected', 35_000);
            const seconds = (performance.now() - started) / 1_000;
            record({
                id: 'NFR-07',
                what: 'trc-rocky paused: time until the app marks it disconnected',
                value: seconds,
                unit: 's',
                target: '≤ 30 s',
            });
            expect(seconds).toBeLessThanOrEqual(30);
        } finally {
            execFileSync('docker', [...docker, 'unpause', 'trc-test-hosts-rocky-1'], { windowsHide: true });
        }
    }, 90_000);
});
