import type { ServerMessage } from '@trc/protocol';
import { afterAll, describe, expect, it } from 'vitest';
import {
    closeLiveHosts,
    connectLive,
    type LiveHost,
    type LiveSession,
    sshRoundTrip,
    testHostsMissing,
} from './live-host';
import { percentile, record } from './stats';

const missing = testHostsMissing();
const SESSIONS = 100;
const HOSTS = 25;
const STATE_TARGET_MS = 250;
let nextRequest = 500_000;

afterAll(() => closeLiveHosts());

function measured(what: string, value: number, unit: string, target: string): void {
    record({ id: 'NFR-05', what, value, unit, target });
}

/** Creates a session and returns its id and how long the reply took. */
async function create(host: LiveHost): Promise<{ readonly id: string; readonly ms: number }> {
    const requestId = nextRequest++;
    const sent = performance.now();
    const spec = { env: {}, size: { cols: 80, rows: 24 } };
    const { message, at } = await host.request(
        { type: 'create', requestId, spec },
        'created',
        (reply) => reply.requestId === requestId,
    );
    return { id: message.session.id, ms: at - sent };
}

/** Renames a session and returns how long the change took to come back as a session event. */
async function rename(host: LiveHost, session: string, name: string): Promise<number> {
    const renamed = (message: ServerMessage): boolean =>
        message.type === 'sessionEvent' &&
        message.change.kind === 'updated' &&
        message.change.session.id === session &&
        message.change.session.customName === name;
    const event = host.message(renamed);
    const sent = performance.now();
    host.connection.send({ type: 'rename', requestId: nextRequest++, session, name });
    return (await event) - sent;
}

/** Times each typed letter until its echo arrives. */
async function echoTimes(session: LiveSession, samples: number): Promise<readonly number[]> {
    session.type('PS1="trc-ready$ "\r');
    await session.next('trc-ready$ ');
    const times: number[] = [];
    for (let index = 0; index < samples; index += 1) {
        const letter = String.fromCharCode(97 + (index % 26));
        const arrived = session.next(letter);
        const sent = performance.now();
        session.type(letter);
        times.push((await arrived) - sent);
        await new Promise((done) => setTimeout(done, 20));
    }
    session.type('\u0015');
    return times;
}

describe.skipIf(missing !== undefined)('scale: sessions per host (NFR-05)', () => {
    it(`runs ${SESSIONS} sessions on one host, and state changes reach the app within ${STATE_TARGET_MS} ms, p95`, async () => {
        const host = await connectLive('trc-ubuntu');
        const created: { readonly id: string; readonly ms: number }[] = [];
        for (let index = 0; index < SESSIONS; index += 1) {
            created.push(await create(host));
        }
        const renames: number[] = [];
        for (const [index, { id }] of created.entries()) {
            renames.push(await rename(host, id, `nfr-${index}`));
        }
        const budget = (await sshRoundTrip(host)) + 10;
        const echo = percentile(await echoTimes(await host.session(), 40), 95);
        const renameP95 = percentile(renames, 95);
        const createP95 = percentile(
            created.map(({ ms }) => ms),
            95,
        );
        measured(`trc-ubuntu: create a session, with up to ${SESSIONS} running, p95`, createP95, 'ms', '—');
        measured(
            `trc-ubuntu: rename to session event, ${SESSIONS} sessions, p95`,
            renameP95,
            'ms',
            `≤ ${STATE_TARGET_MS} ms`,
        );
        measured(
            `trc-ubuntu: keystroke to echo with ${SESSIONS + 1} sessions, p95`,
            echo,
            'ms',
            `≤ ${budget.toFixed(1)} ms`,
        );
        expect(renameP95).toBeLessThanOrEqual(STATE_TARGET_MS);
        expect(echo).toBeLessThanOrEqual(budget);
    }, 600_000);
});

describe.skipIf(missing !== undefined)('scale: hosts per app (NFR-05)', () => {
    it(`keeps ${HOSTS} hosts connected at once, each answering within the targets`, async () => {
        const aliases = Array.from({ length: HOSTS }, (_, index) => `trc-scale-${String(index + 1).padStart(2, '0')}`);
        const started = performance.now();
        const hosts = await Promise.all(aliases.map((alias) => connectLive(alias)));
        const connectSeconds = (performance.now() - started) / 1_000;
        const renames: number[] = [];
        const echoes: number[] = [];
        const roundTrips: number[] = [];
        for (const host of hosts) {
            const { id } = await create(host);
            renames.push(await rename(host, id, `nfr-${host.alias}`));
            roundTrips.push(await sshRoundTrip(host, 5));
            echoes.push(...(await echoTimes(await host.session(), 20)));
        }
        const budget = percentile(roundTrips, 50) + 10;
        const echoP95 = percentile(echoes, 95);
        const renameP95 = percentile(renames, 95);
        measured(`${HOSTS} hosts: connect and install all at once`, connectSeconds, 's', '—');
        measured(`${HOSTS} hosts: rename to session event, p95`, renameP95, 'ms', `≤ ${STATE_TARGET_MS} ms`);
        measured(
            `${HOSTS} hosts: keystroke to echo, every keystroke on every host, p95`,
            echoP95,
            'ms',
            `≤ ${budget.toFixed(1)} ms`,
        );
        expect(hosts.every((host) => host.states.at(-1)?.status === 'connected')).toBe(true);
        expect(renameP95).toBeLessThanOrEqual(STATE_TARGET_MS);
        expect(echoP95).toBeLessThanOrEqual(budget);
    }, 600_000);
});
