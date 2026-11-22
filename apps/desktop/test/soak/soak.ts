import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { basename, dirname } from 'node:path';
import { bootOutAgent } from '../mac-hosts';
import { LiveHost, type LiveOptions, type LiveSession, LOCAL_ALIAS, ssh, waitFor } from '../nfr/live-host';
import { percentile, record } from '../nfr/stats';
import { dockerContextArguments, killMatching } from '../test-platform';

/** How many cycles each scenario runs (NFR-11's 1,000 unless `TRC_SOAK_CYCLES` says otherwise). */
export const CYCLES = soakCycles('TRC_SOAK_CYCLES', 1_000);

export { OLD_DAEMONS } from './old-daemons';

/** How a soak connects: as a live host does, and whether the connection counts as a reconnect in NFR-07's sample. */
export interface SoakConnectOptions extends LiveOptions {
    /** False for a connection that is part of the disruption, such as the 0.2.0 one an upgrade cycle starts with. */
    readonly timed?: boolean;
}

/** The cycle count `name` sets, `fallback` when unset; anything but a positive whole number stops the run. */
export function soakCycles(name: string, fallback: number): number {
    const value = process.env[name];
    const cycles = value === undefined ? fallback : Number(value);
    if (!Number.isInteger(cycles) || cycles < 1) {
        throw new Error(`${name} must be a positive whole number, not ${JSON.stringify(value)}`);
    }
    return cycles;
}

/** What one cycle does to the host before the sessions are checked: it returns the connection to check them over. */
export type Disruption = (run: SoakRun, cycle: number) => Promise<LiveHost>;

/** A session the soak watches: its ID and its shell's PID when the soak began. */
interface Watched {
    readonly id: string;
    readonly pid: number;
}

/**
 * One soak scenario on one host (NFR-11, P-25): sessions are created under a scratch install root, then every cycle
 * has each session wait to print a marker, disrupts the host, tells the sessions to print it once the disruption has
 * taken effect ({@link SoakRun.away}), and checks that each session is still listed with the same shell PID, shows
 * the marker its old connection never saw, and still runs what is typed into it. After a disruption that leaves the
 * old connection stalled, sessions resume from where its output stood, and the marker must arrive exactly once
 * (US-2.2.2). The first loss stops the run with what was lost.
 */
export class SoakRun {
    readonly alias: string;
    readonly root = `.trc-soak-${randomBytes(4).toString('hex')}`;
    /** How long each cycle's connection took to come back, in ms. */
    readonly #reconnects: number[] = [];
    #watched: readonly Watched[] = [];
    #host: LiveHost | undefined;
    /** Each watched session as attached over the current connection. */
    #open = new Map<string, LiveSession>();
    /** The stalled connection the next check resumes every session from. */
    #resumeFrom: LiveHost | undefined;
    /** The last cycle whose disruption told the sessions to print their marker. */
    #awayIn = 0;

    /** A run on `alias`. */
    constructor(alias: string) {
        this.alias = alias;
    }

    /** The connection the last cycle checked over. */
    get host(): LiveHost {
        if (this.#host === undefined) {
            throw new Error('the soak has not started');
        }
        return this.#host;
    }

    /** Connects with `options.daemons` or the app's own and creates `sessions` sessions to watch. */
    async start(sessions: number, options: LiveOptions = {}): Promise<void> {
        const host = await this.connect(options);
        this.#reconnects.splice(0);
        for (let index = 0; index < sessions; index += 1) {
            const session = await host.session();
            this.#open.set(session.id, session);
        }
        this.#watched = (await this.#listed(host)).map(({ id, pid }) => ({ id, pid: pid ?? -1 }));
        if (this.#watched.length !== sessions || this.#watched.some((session) => session.pid < 0)) {
            throw new Error(`expected ${sessions} running sessions, found ${JSON.stringify(this.#watched)}`);
        }
    }

    /** Connects again to the run's install root, timing it as a reconnect unless `options.timed` is false. */
    async connect(options: SoakConnectOptions = {}): Promise<LiveHost> {
        const started = performance.now();
        const host = new LiveHost(this.alias, this.root, options);
        await host.connection.connect();
        await waitFor(() => ['connected', 'failed', 'host-key'].includes(host.states.at(-1)?.status ?? ''), 60_000);
        if (host.states.at(-1)?.status !== 'connected') {
            throw new Error(`${this.alias} did not connect: ${JSON.stringify(host.states.at(-1))}`);
        }
        if (options.timed !== false) {
            this.#reconnects.push(performance.now() - started);
        }
        this.#host = host;
        return host;
    }

    /** Runs `cycles` cycles of `disrupt`, checking every session after each; throws at the first loss. */
    async soak(cycles: number, disrupt: Disruption): Promise<void> {
        for (let cycle = 1; cycle <= cycles; cycle += 1) {
            await this.#markAway(cycle);
            const host = await disrupt(this, cycle);
            if (this.#awayIn !== cycle) {
                throw new Error(`cycle ${cycle}: the disruption never called away()`);
            }
            await this.check(host, cycle);
        }
    }

    /**
     * The disruption has taken effect: every session prints the cycle's marker now. The flag is set from outside the
     * host's sshd, so it starts no login.
     */
    away(cycle: number): void {
        if (this.alias.startsWith('trc-mac') || this.alias === LOCAL_ALIAS) {
            ssh(this.alias, `touch ${this.#awayFlag(cycle)}`);
        } else {
            onHost(this.alias, ['touch', this.#awayFlag(cycle)]);
        }
        this.#awayIn = cycle;
    }

    /** Has the next check resume every session from where `stalled`'s output stood, as a reconnect does. */
    resumeFrom(stalled: LiveHost): void {
        this.#resumeFrom = stalled;
    }

    /** Checks every watched session: listed, with its shell PID, the cycle's marker, and running what is typed. */
    async check(host: LiveHost, cycle: number): Promise<void> {
        const listed = new Map((await this.#listed(host)).map((session) => [session.id, session]));
        const opened = new Map<string, LiveSession>();
        for (const [index, watched] of this.#watched.entries()) {
            const now = listed.get(watched.id);
            if (now === undefined || now.pid !== watched.pid || now.state !== 'running') {
                throw new Error(`cycle ${cycle}: session ${watched.id} lost: ${JSON.stringify(now)}`);
            }
            const previous = this.#open.get(watched.id);
            if (previous?.tail().includes(awayMarker(cycle, index)) === true) {
                throw new Error(`cycle ${cycle}: session ${watched.id} printed its marker before the disruption`);
            }
            const session = await this.#reattach(host, watched.id, cycle);
            await this.#showsAway(session, cycle, index);
            const marker = `soak-${cycle}-${index}-ok`;
            const echoed = session.next(marker, 15_000);
            session.type(`echo soak-${cycle}-${index}-o''k\r`);
            await echoed.catch((error: unknown) => {
                throw new Error(`cycle ${cycle}: session ${watched.id} does not run what is typed: ${String(error)}`);
            });
            onceAfterResume(session, cycle, index);
            opened.set(watched.id, session);
        }
        this.#open = opened;
        this.#resumeFrom = undefined;
    }

    /**
     * Records the run's results for `docs/verification/E2-nfr.md`, and fails when connecting again took longer than
     * NFR-07's 5 s at p95.
     */
    report(scenario: string, cycles: number): void {
        const what = `${scenario} on ${this.alias}`;
        const p95 = percentile(this.#reconnects, 95);
        record({ id: 'NFR-11', what: `${what}: sessions lost in ${cycles} cycles`, value: 0, unit: '', target: '0' });
        record({
            id: 'NFR-07',
            what: `${what}: connect again (ssh and daemon check), p95 of ${this.#reconnects.length}`,
            value: p95,
            unit: 'ms',
            target: '≤ 5,000 ms',
        });
        if (p95 > 5_000) {
            throw new Error(`${what}: connecting again took ${Math.round(p95)} ms at p95, over NFR-07's 5,000 ms`);
        }
    }

    /** Stops the run's daemon, with its systemd unit or LaunchAgent, and removes its install (P-58). */
    remove(): void {
        this.#host?.connection.close();
        const root = `$HOME/${this.root}`;
        const unit = `systemctl --user stop "trcd-$(printf %s "${root}" | sha256sum | cut -c1-8).service" 2>/dev/null`;
        const stop = `kill $(head -n 1 ${root}/run/core.lock 2>/dev/null) 2>/dev/null; pkill -f "[/]${this.root}/versions"`;
        try {
            ssh(this.alias, `${bootOutAgent(root)}; ${unit}; ${stop}; rm -rf ${root} /tmp/${this.root}-away-*`);
        } catch {
            return;
        }
    }

    /**
     * Has every session wait for the cycle's flag and then print its marker, once the shell runs the command: it
     * prints that it is armed first, as a shell's line editor may redraw what is typed (zsh does).
     */
    async #markAway(cycle: number): Promise<void> {
        for (const [index, watched] of this.#watched.entries()) {
            const session = this.#open.get(watched.id);
            if (session === undefined) {
                throw new Error(`cycle ${cycle}: session ${watched.id} is not attached`);
            }
            const armed = session.next(`away-${cycle}-${index}-armed`, 15_000);
            const wait = `until [ -e ${this.#awayFlag(cycle)} ]; do sleep 0.05; done`;
            session.type(`echo away-${cycle}-${index}-ar''med; ${wait}; echo away-${cycle}-${index}-d''one\r`);
            await armed;
        }
    }

    #awayFlag(cycle: number): string {
        return `/tmp/${this.root}-away-${cycle}`;
    }

    /** Attaches to a session again: from where the stalled connection's output stood, which must replay a delta. */
    async #reattach(host: LiveHost, id: string, cycle: number): Promise<LiveSession> {
        const previous = this.#open.get(id);
        const from = previous === undefined ? undefined : this.#resumeFrom?.offsetOf(previous.stream);
        if (this.#resumeFrom !== undefined && from === undefined) {
            throw new Error(`cycle ${cycle}: session ${id} has no offset to resume from`);
        }
        const session = await host.attach(id, from);
        if (from !== undefined && session.replay !== 'delta') {
            throw new Error(`cycle ${cycle}: session ${id} replayed ${String(session.replay)}, not the output missed`);
        }
        return session;
    }

    /** Checks that the marker the session printed while away arrived. */
    async #showsAway(session: LiveSession, cycle: number, index: number): Promise<void> {
        await waitFor(() => session.tail().includes(awayMarker(cycle, index)), 15_000).catch(() => {
            throw new Error(`cycle ${cycle}: session ${session.id} lost the output written while away`);
        });
    }

    async #listed(host: LiveHost) {
        const { message } = await host.request({ type: 'listSessions', requestId: 69_999 }, 'sessions');
        return message.sessions;
    }
}

/**
 * Runs a command on a test host as its test user, from outside its sshd, so it starts no login and changes no session;
 * returns its output.
 */
export function onHost(alias: string, command: readonly string[]): string {
    const container = `trc-test-hosts-${alias.replace(/^trc-/, '')}-1`;
    const args = [...dockerContextArguments(), 'exec', '-u', 'tester', container, ...command];
    return execFileSync('docker', args, { encoding: 'utf8', timeout: 30_000, windowsHide: true });
}

/** The PID of the run's core, from its lock. */
export function corePid(run: SoakRun): string {
    return ssh(run.alias, `head -n 1 ~/${run.root}/run/core.lock 2>/dev/null`).trim();
}

/**
 * Sends `signal` to the ssh process of a live host's connection, found by its known-hosts file. Windows can only kill
 * it, with TerminateProcess; stopping and continuing it, which the flap soak does, stays macOS's. Fails with status 1,
 * as pkill does, when no ssh matched.
 */
export function signalSsh(host: LiveHost, signal: 'KILL' | 'STOP' | 'CONT'): void {
    if (host.knownHosts === '') {
        throw new Error('the connection has no known-hosts file to find its ssh by');
    }
    if (process.platform !== 'win32') {
        execFileSync('pkill', [`-${signal}`, '-f', host.knownHosts]);
        return;
    }
    if (signal !== 'KILL') {
        throw new Error(`Windows cannot ${signal} a process; the flap soak runs on macOS`);
    }
    if (killMatching([basename(dirname(host.knownHosts)), 'known_hosts']) === 0) {
        throw Object.assign(new Error('no ssh matched'), { status: 1 });
    }
}

/** Kills a connection's ssh when it still runs; one that already ended is fine. */
export function endSsh(host: LiveHost): void {
    try {
        signalSsh(host, 'KILL');
    } catch (error) {
        if (exitStatus(error) !== 1) {
            throw error;
        }
    }
}

/** Waits until a host's connection reports that it ended. */
export function ended(host: LiveHost): Promise<void> {
    return waitFor(() => ['disconnected', 'closed', 'failed'].includes(host.states.at(-1)?.status ?? ''), 60_000);
}

/** What a session prints while the host is disrupted in `cycle`. */
function awayMarker(cycle: number, index: number): string {
    return `away-${cycle}-${index}-done`;
}

/** After a resume, a session shows what it printed while away exactly once: the delta neither lost nor repeated it. */
function onceAfterResume(session: LiveSession, cycle: number, index: number): void {
    const seen = session.tail().split(awayMarker(cycle, index)).length - 1;
    if (session.replay === 'delta' && seen !== 1) {
        throw new Error(`cycle ${cycle}: session ${session.id} showed the output written while away ${seen} times`);
    }
}

/** The exit status a failed `execFileSync` carries, if `error` is one. */
function exitStatus(error: unknown): number | undefined {
    if (typeof error !== 'object' || error === null || !('status' in error)) {
        return undefined;
    }
    return typeof error.status === 'number' ? error.status : undefined;
}
