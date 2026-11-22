import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { launchApp } from '../e2e/support/launch';
import { LOCAL_DAEMON, launchLocal, removeLocalDaemon, scratchLocal } from '../e2e/support/local-host';
import {
    launchWithTestHosts,
    openTerminal,
    removeInstall,
    rowTexts,
    scratchInstallRoot,
    testHostsMissing,
} from '../e2e/support/test-host';
import { killMatching } from '../test-platform';
import { ECHO_ALLOWANCE_MS, ECHO_PERCENTILE, ECHO_SAMPLES } from './echo-target';
import { closeLiveHosts, connectLive, type LiveHost, roundTrips, ssh } from './live-host';
import { percentile, record } from './stats';

const missing = testHostsMissing();
const PROMPT = 'trc-ready$ ';
const FLOOD = [
    'import os, signal, sys, time',
    'def stop(*_):',
    '    with open(sys.argv[1], "w") as out: out.write(repr(time.time()))',
    '    os._exit(0)',
    'signal.signal(signal.SIGINT, stop)',
    'line = "y" * 79 + "\\n"',
    'while True: sys.stdout.write(line)',
].join('\n');

interface EchoProbe {
    index: number;
    keys: number[];
    pending: { readonly key: string; readonly index: number; readonly at: number }[];
    surface: number[];
}

interface ProbeWindow {
    __trcEcho?: EchoProbe;
    __trcWriteTimings?: { readonly arrived: number; readonly parsed: number }[];
    __trcSpoken?: { readonly text: string; readonly at: number }[];
}

/** Keystroke latencies: to the echo parsed by the terminal (the app's work), and to the text surface (next frame). */
interface EchoTimes {
    readonly parsed: readonly number[];
    readonly surface: readonly number[];
}

test.afterAll(() => closeLiveHosts());

/** Pings sampled over another connection to the host just before the app types, for the link's round trip. */
const LINK_SAMPLES = 100;

async function screen(terminal: Locator): Promise<string> {
    return (await rowTexts(terminal)).join('\n');
}

async function ready(window: Page, terminal: Locator): Promise<void> {
    await terminal.focus();
    await expect.poll(() => screen(terminal), { timeout: 30_000 }).toMatch(/[$#%] *$/m);
    await window.keyboard.type(`PS1='${PROMPT}'`);
    await window.keyboard.press('Enter');
    await window.keyboard.type('clear');
    await window.keyboard.press('Enter');
    await expect.poll(() => screen(terminal)).toMatch(/^trc-ready\$\s*$/m);
}

/** Records each typed letter's keydown, and when its echo reaches the text surface after the prompt. */
function probeEcho(terminal: Locator): Promise<void> {
    return terminal.evaluate((surface, prompt) => {
        const probe: EchoProbe = { index: 0, keys: [], pending: [], surface: [] };
        const page = globalThis as ProbeWindow;
        page.__trcEcho = probe;
        page.__trcWriteTimings = [];
        document.addEventListener(
            'keydown',
            (event) => {
                if (/^[a-z]$/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
                    const at = performance.now();
                    probe.keys.push(at);
                    probe.pending.push({ key: event.key, index: probe.index, at });
                    probe.index += 1;
                }
            },
            true,
        );
        const echoed = (): void => {
            const rows = [...surface.querySelectorAll('[data-row]')].map((row) => row.textContent ?? '');
            const typed = rows.find((row) => row.startsWith(prompt))?.slice(prompt.length) ?? '';
            for (
                let next = probe.pending[0];
                next !== undefined && typed[next.index] === next.key;
                next = probe.pending[0]
            ) {
                probe.pending.shift();
                probe.surface.push(performance.now() - next.at);
            }
        };
        new MutationObserver(echoed).observe(surface, { subtree: true, childList: true, characterData: true });
    }, PROMPT);
}

/** Starts a new line of typing: clears the shell's line and the probe's position in it. */
async function newLine(window: Page, terminal: Locator): Promise<void> {
    await window.keyboard.press('Control+U');
    await terminal.evaluate(() => {
        const probe = (globalThis as ProbeWindow).__trcEcho;
        if (probe !== undefined) {
            probe.index = 0;
            probe.pending = [];
        }
    });
    await window.waitForTimeout(100);
}

/** Pairs each keydown with the first write that arrived after it, and returns keydown to parsed. */
function parsedTimes(terminal: Locator): Promise<readonly number[]> {
    return terminal.evaluate(() => {
        const page = globalThis as ProbeWindow;
        const writes = page.__trcWriteTimings ?? [];
        return (page.__trcEcho?.keys ?? []).flatMap((key) => {
            const write = writes.find((candidate) => candidate.arrived > key);
            return write === undefined ? [] : [write.parsed - key];
        });
    });
}

/** Types `letters` letters `gapMs` apart, wider than the round trip, so each echo pairs with its own keydown. */
async function typeAndTimeEcho(window: Page, terminal: Locator, letters: number, gapMs: number): Promise<EchoTimes> {
    await probeEcho(terminal);
    for (let index = 0; index < letters; index += 1) {
        if (index > 0 && index % 25 === 0) {
            await newLine(window, terminal);
        }
        await window.keyboard.press(String.fromCharCode(97 + (index % 25)));
        await window.waitForTimeout(gapMs);
    }
    await window.waitForTimeout(300);
    const parsed = await parsedTimes(terminal);
    const surface = await terminal.evaluate(() => [...((globalThis as ProbeWindow).__trcEcho?.surface ?? [])]);
    await window.keyboard.press('Control+U');
    return { parsed, surface };
}

/** The link's round trip NFR-02's frame is added to: its own p95, so its jitter is not counted as the app's (P-35). */
function linkBaseline(linkTimes: readonly number[]): number {
    return percentile(linkTimes, 95);
}

/** The host clock minus this machine's, from a timestamp echo over a live session, to within half its round trip. */
async function clockOffset(host: LiveHost): Promise<number> {
    const session = await host.session();
    session.type(`python3 -u -c 'import sys,time\nfor _ in sys.stdin: print("TRCT%.6fTRCE" % time.time())'\r`);
    await new Promise((done) => setTimeout(done, 1_000));
    const samples: { readonly rtt: number; readonly offset: number }[] = [];
    for (let index = 0; index < 20; index += 1) {
        const arrived = session.next('TRCE');
        const sent = performance.timeOrigin + performance.now();
        session.type('\r');
        const received = performance.timeOrigin + (await arrived);
        const remote = Number([...session.tail().matchAll(/TRCT(\d+\.\d+)TRCE/g)].at(-1)?.[1]) * 1_000;
        samples.push({ rtt: received - sent, offset: remote - (sent + received) / 2 });
    }
    return samples.reduce((best, sample) => (sample.rtt < best.rtt ? sample : best)).offset;
}

/** Records each announcement with its time, through `ariaNotify` or a live region (A11Y-02). */
function recordTimedSpeech(window: Page): Promise<void> {
    return window.evaluate(() => {
        const spoken: { text: string; at: number }[] = [];
        (globalThis as ProbeWindow).__trcSpoken = spoken;
        const page = document as Document & { ariaNotify?: (text: string, options?: unknown) => void };
        const notify = page.ariaNotify?.bind(page);
        if (notify !== undefined) {
            page.ariaNotify = (text, options) => {
                spoken.push({ text, at: performance.now() });
                notify(text, options);
            };
        }
        const changed = (records: MutationRecord[]): void => {
            const at = performance.now();
            const regions = records
                .map((change) => change.target.parentElement?.closest('[aria-live]') ?? change.target)
                .filter(
                    (region): region is HTMLElement =>
                        region instanceof HTMLElement && region.hasAttribute('aria-live'),
                );
            spoken.push(...regions.map((region) => ({ text: region.textContent ?? '', at })));
        };
        new MutationObserver(changed).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
}

/** When the first announcement holding `word` was made, or `undefined` before it is. */
function spokenAt(window: Page, word: string): Promise<number | undefined> {
    return window.evaluate(
        (wanted) => (globalThis as ProbeWindow).__trcSpoken?.find((entry) => entry.text.includes(wanted))?.at,
        word,
    );
}

/** The gaps between animation frames over `ms`, which show whether the window keeps drawing and taking input. */
function frameGaps(window: Page, ms: number): Promise<readonly number[]> {
    return window.evaluate(
        (duration) =>
            new Promise<number[]>((done) => {
                const gaps: number[] = [];
                let last = performance.now();
                const end = last + duration;
                const frame = (now: number): void => {
                    gaps.push(now - last);
                    last = now;
                    if (now < end) {
                        requestAnimationFrame(frame);
                    } else {
                        done(gaps);
                    }
                };
                requestAnimationFrame(frame);
            }),
        ms,
    );
}

/** One flood round: how long Ctrl+C took to reach the program, by the host's clock, and the frame gaps meanwhile. */
async function interruptRound(
    window: Page,
    round: number,
    offset: number,
): Promise<{ readonly delay: number; readonly gaps: readonly number[] }> {
    const marker = `/tmp/trc-int-${round}`;
    ssh('trc-ubuntu', `rm -f ${marker}`);
    await window.keyboard.type(`python3 /tmp/trc-ui-flood.py ${marker}`);
    await window.keyboard.press('Enter');
    const gaps = await frameGaps(window, 1_500);
    const pressed = await window.evaluate(() => performance.timeOrigin + performance.now());
    await window.keyboard.press('Control+C');
    const read = (): string => ssh('trc-ubuntu', `cat ${marker} 2>/dev/null`).trim();
    await expect.poll(read, { timeout: 10_000 }).not.toBe('');
    const delivered = Number(read()) * 1_000 - offset;
    await window.waitForTimeout(1_000);
    return { delay: delivered - pressed, gaps };
}

/** Runs `rounds` idle commands and returns, for each, the time from Return to the announcement of its output. */
async function speechDelays(window: Page, rounds: number): Promise<readonly number[]> {
    const delays: number[] = [];
    for (let round = 0; round < rounds; round += 1) {
        await window.keyboard.type(`echo trc-said-""${round}`);
        await window.waitForTimeout(600);
        const pressed = await window.evaluate(() => performance.now());
        await window.keyboard.press('Enter');
        const word = `trc-said-${round}`;
        await expect.poll(() => spokenAt(window, word), { timeout: 10_000 }).not.toBeUndefined();
        delays.push(((await spokenAt(window, word)) ?? 0) - pressed);
        await window.waitForTimeout(800);
    }
    return delays;
}

/** Times, in `rounds` rounds, from Return on a failing command to the announcement of its failure (US-5.2.2). */
async function failureDelays(window: Page, rounds: number): Promise<readonly number[]> {
    const delays: number[] = [];
    for (let round = 0; round < rounds; round += 1) {
        const code = 10 + round;
        await window.keyboard.type(`(exit ${code})`);
        await window.waitForTimeout(600);
        const pressed = await window.evaluate(() => performance.now());
        await window.keyboard.press('Enter');
        const said = `Command failed, exit code ${code}.`;
        await expect.poll(() => spokenAt(window, said), { timeout: 10_000 }).not.toBeUndefined();
        delays.push(((await spokenAt(window, said)) ?? 0) - pressed);
        await window.waitForTimeout(800);
    }
    return delays;
}

test.describe('UI echo latency on live hosts (NFR-02)', () => {
    test.skip(missing !== undefined, missing);
    test.setTimeout(240_000);

    for (const alias of ['trc-ubuntu', 'trc-latency'] as const) {
        test(`readies the echo of typing on ${alias} within the SSH round trip plus a frame, p99 (NFR-02)`, async () => {
            const root = scratchInstallRoot();
            const { app, window } = await launchWithTestHosts(root);
            try {
                const terminal = await openTerminal(window, alias);
                await ready(window, terminal);
                const linkTimes = await roundTrips(await connectLive(alias), LINK_SAMPLES, 40);
                const gap = Math.ceil(percentile(linkTimes, 50)) + 40;
                const { parsed, surface } = await typeAndTimeEcho(window, terminal, ECHO_SAMPLES, gap);
                expect(parsed, 'one echo per typed letter').toHaveLength(ECHO_SAMPLES);
                const link = linkBaseline(linkTimes);
                const app99 = percentile(parsed, ECHO_PERCENTILE);
                for (const p of [50, 95, 99]) {
                    record({
                        id: 'NFR-02',
                        what: `${alias}: SSH round trip before the app types, ping to pong over the channel, p${p}`,
                        value: percentile(linkTimes, p),
                        unit: 'ms',
                        target: '—',
                    });
                }
                record({
                    id: 'NFR-02',
                    what: `${alias}: keystroke to its echo parsed in the app, p${ECHO_PERCENTILE}`,
                    value: app99,
                    unit: 'ms',
                    target: `≤ ${(link + ECHO_ALLOWANCE_MS).toFixed(1)} ms`,
                });
                record({
                    id: 'NFR-02',
                    what: `${alias}: keystroke to its echo on the text surface (next frame), p${ECHO_PERCENTILE}`,
                    value: percentile(surface, ECHO_PERCENTILE),
                    unit: 'ms',
                    target: 'next frame',
                });
                expect(app99).toBeLessThanOrEqual(link + ECHO_ALLOWANCE_MS);
            } finally {
                await app.close();
                removeInstall(alias, root);
            }
        });
    }
});

test.describe('UI echo latency on This computer (NFR-01)', () => {
    test.skip(process.platform !== 'darwin' || !existsSync(LOCAL_DAEMON), 'needs macOS and pnpm build:daemon');

    test('readies the echo of typing in a local session within one frame, p99 (NFR-01)', async () => {
        const local = scratchLocal();
        try {
            const { app, window } = await launchLocal(local);
            await window.getByRole('button', { name: 'New session on This computer' }).click();
            const terminal = window.getByRole('textbox', { name: /, This computer$/ });
            await terminal.waitFor({ timeout: 30_000 });
            await ready(window, terminal);
            const { parsed, surface } = await typeAndTimeEcho(window, terminal, ECHO_SAMPLES, 40);
            expect(parsed, 'one echo per typed letter').toHaveLength(ECHO_SAMPLES);
            const app99 = percentile(parsed, ECHO_PERCENTILE);
            for (const p of [50, 95, ECHO_PERCENTILE]) {
                record({
                    id: 'NFR-01',
                    what: `This computer: keystroke to its echo parsed in the app, p${p}`,
                    value: percentile(parsed, p),
                    unit: 'ms',
                    target: p === ECHO_PERCENTILE ? `≤ ${ECHO_ALLOWANCE_MS.toFixed(1)} ms` : '—',
                });
            }
            record({
                id: 'NFR-01',
                what: `This computer: keystroke to its echo on the text surface (next frame), p${ECHO_PERCENTILE}`,
                value: percentile(surface, ECHO_PERCENTILE),
                unit: 'ms',
                target: 'next frame',
            });
            await app.close();
            expect(app99).toBeLessThanOrEqual(ECHO_ALLOWANCE_MS);
        } finally {
            removeLocalDaemon(local.trcHome);
        }
    });
});

test.describe('UI responsiveness under a flood on a live host (NFR-03)', () => {
    test.skip(missing !== undefined, missing);
    test.setTimeout(240_000);

    test('delivers Ctrl+C typed in the app to a flooding program within 100 ms, p95, and stays interactive (NFR-03)', async () => {
        const root = scratchInstallRoot();
        const { app, window } = await launchWithTestHosts(root);
        try {
            const terminal = await openTerminal(window, 'trc-ubuntu');
            await ready(window, terminal);
            ssh('trc-ubuntu', `echo ${Buffer.from(FLOOD).toString('base64')} | base64 -d > /tmp/trc-ui-flood.py`);
            const offset = await clockOffset(await connectLive('trc-ubuntu'));
            const delays: number[] = [];
            const gaps: number[] = [];
            for (let round = 0; round < 10; round += 1) {
                const result = await interruptRound(window, round, offset);
                delays.push(result.delay);
                gaps.push(...result.gaps);
            }
            const p95 = percentile(delays, 95);
            const frames = percentile(gaps, 95);
            record({
                id: 'NFR-03',
                what: 'trc-ubuntu: Ctrl+C in the app to SIGINT in the flooding program, p95',
                value: p95,
                unit: 'ms',
                target: '≤ 100 ms',
            });
            record({
                id: 'NFR-03',
                what: 'trc-ubuntu: time between frames while the flood runs, p95',
                value: frames,
                unit: 'ms',
                target: '≤ 100 ms',
            });
            expect(p95).toBeLessThanOrEqual(100);
            expect(frames).toBeLessThanOrEqual(100);
        } finally {
            await app.close();
            removeInstall('trc-ubuntu', root);
        }
    });
});

test.describe('Speech of new output on a live host (NFR-04)', () => {
    test.skip(missing !== undefined, missing);
    test.setTimeout(240_000);

    test('starts speaking new output within 500 ms when idle, p95 (NFR-04)', async () => {
        const root = scratchInstallRoot();
        const { app, window } = await launchWithTestHosts(root, { args: ['--screen-reader-mode=on'] });
        try {
            const terminal = await openTerminal(window, 'trc-ubuntu');
            await ready(window, terminal);
            await recordTimedSpeech(window);
            const p95 = percentile(await speechDelays(window, 15), 95);
            record({
                id: 'NFR-04',
                what: 'trc-ubuntu, screen-reader mode: Return to the announcement of the output, p95',
                value: p95,
                unit: 'ms',
                target: '≤ 500 ms',
            });
            expect(p95).toBeLessThanOrEqual(500);
        } finally {
            await app.close();
            removeInstall('trc-ubuntu', root);
        }
    });

    test('announces a failed command within 500 ms of Return, p95 (NFR-04, US-5.2.2)', async () => {
        const root = scratchInstallRoot();
        const { app, window } = await launchWithTestHosts(root, { args: ['--screen-reader-mode=on'] });
        try {
            const terminal = await openTerminal(window, 'trc-ubuntu');
            await ready(window, terminal);
            await recordTimedSpeech(window);
            const p95 = percentile(await failureDelays(window, 15), 95);
            record({
                id: 'NFR-04',
                what: 'trc-ubuntu, shell integration: Return on a failing command to its announcement, p95',
                value: p95,
                unit: 'ms',
                target: '≤ 500 ms',
            });
            expect(p95).toBeLessThanOrEqual(500);
        } finally {
            await app.close();
            removeInstall('trc-ubuntu', root);
        }
    });
});

/** Launches 5 times with a restored host, timing each from an interactive window to the host reconnecting. */
async function restoredReconnectDelays(root: string): Promise<readonly number[]> {
    const first = await launchWithTestHosts(root);
    await openTerminal(first.window, 'trc-ubuntu');
    await first.app.close();
    const delays: number[] = [];
    for (let round = 0; round < 5; round += 1) {
        const { app, window } = await launchWithTestHosts(root, { scratch: first.scratch });
        try {
            await window.getByRole('combobox', { name: 'New host' }).focus();
            const interactive = performance.now();
            const started = window.getByRole('button', { name: /^(Cancel connecting to|Disconnect) trc-ubuntu$/ });
            await started.waitFor({ timeout: 10_000 });
            delays.push(Math.max(0, performance.now() - interactive));
        } finally {
            await app.close();
        }
    }
    return delays;
}

test.describe('restoring and reconnecting on live hosts (NFR-06, NFR-07)', () => {
    test.skip(missing !== undefined, missing);
    test.setTimeout(240_000);

    test('starts reconnecting a restored host within 1 s of an interactive window (NFR-06)', async () => {
        const root = scratchInstallRoot();
        try {
            const worst = Math.max(...(await restoredReconnectDelays(root)));
            record({
                id: 'NFR-06',
                what: 'interactive window to a restored host reconnecting, worst of 5',
                value: worst,
                unit: 'ms',
                target: '≤ 1,000 ms',
            });
            expect(worst).toBeLessThanOrEqual(1_000);
        } finally {
            removeInstall('trc-ubuntu', root);
        }
    });

    test('reconnects a lost host by itself within 5 s on a healthy network (NFR-07)', async () => {
        const root = scratchInstallRoot();
        const { app, window, scratch } = await launchWithTestHosts(root);
        try {
            const terminal = await openTerminal(window, 'trc-ubuntu');
            await ready(window, terminal);
            const times: number[] = [];
            for (let round = 0; round < 5; round += 1) {
                const lost = performance.now();
                expect(killMatching([basename(scratch), 'known_hosts'])).toBeGreaterThan(0);
                await window
                    .getByRole('textbox', { name: /, trc-ubuntu, (disconnected|reconnecting)$/ })
                    .waitFor({ timeout: 10_000 });
                await window.getByRole('textbox', { name: /, trc-ubuntu$/ }).waitFor({ timeout: 30_000 });
                times.push(performance.now() - lost);
            }
            const worst = Math.max(...times);
            record({
                id: 'NFR-07',
                what: 'trc-ubuntu: ssh killed to the terminal attached again, worst of 5',
                value: worst,
                unit: 'ms',
                target: '≤ 5,000 ms',
            });
            expect(worst).toBeLessThanOrEqual(5_000);
        } finally {
            await app.close();
            removeInstall('trc-ubuntu', root);
        }
    });
});

test('opens an interactive window within 2 s of launch (NFR-06)', async () => {
    const times: number[] = [];
    for (let round = 0; round < 5; round += 1) {
        const started = performance.now();
        const app = await launchApp();
        const window = await app.firstWindow();
        const field = window.getByRole('combobox', { name: 'New host' });
        await field.focus();
        await expect(field).toBeFocused();
        times.push(performance.now() - started);
        await app.close();
    }
    const worst = Math.max(...times);
    record({
        id: 'NFR-06',
        what: 'launch to an interactive window (test build, Playwright included), worst of 5',
        value: worst,
        unit: 'ms',
        target: '≤ 2,000 ms',
    });
    expect(worst).toBeLessThanOrEqual(2_000);
});
