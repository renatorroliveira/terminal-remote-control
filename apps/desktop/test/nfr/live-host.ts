import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ClientMessage, CreateSessionSpec, Replay, ServerMessage } from '@trc/protocol';
import { parseDaemonManifest } from '../../src/connection-host/bootstrap/manifest';
import { type ConnectionRuntime, HostConnection } from '../../src/connection-host/connection/host-connection';
import { createAppLogger } from '../../src/connection-host/logging/app-log';
import type { ConnectionState } from '../../src/shared/connection';
import { percentile } from './stats';

const repository = resolve(import.meta.dirname, '../../../..');
const run = join(repository, 'tools/test-hosts/.run');
const resources = join(repository, 'apps/desktop/resources');
const scratch = mkdtempSync(join(tmpdir(), 'trc-nfr-'));
const TAIL = 64 * 1024;
/** The line the test hosts' .bashrc prints on every login (tools/test-hosts/images/common/noisy.bashrc). */
const LOGIN_BANNER = 'Welcome to the trc test host';

/** The app log folder every live host in this run writes to (SEC-08 reads it). */
export const APP_LOGS = join(scratch, 'logs');

/** A reply and the time it arrived. */
export interface Reply<T extends ServerMessage['type']> {
    readonly message: Extract<ServerMessage, { type: T }>;
    readonly at: number;
}

/** One attached session: its stream and the output received, kept as a bounded tail plus a byte count. */
export interface LiveSession {
    readonly id: string;
    readonly stream: number;
    /** Sends bytes as typing. */
    type(text: string): void;
    /** Resolves with `performance.now()` at the moment `text` arrives in output received after this call. */
    next(text: string, timeoutMs?: number): Promise<number>;
    /** Bytes received so far. */
    received(): number;
    /** The last 64 KiB received. */
    tail(): string;
    /** What the attach replays, when the daemon says (protocol 2). */
    readonly replay?: Replay;
}

/** Why the test hosts cannot be used, or `undefined` when they can. */
export function testHostsMissing(): string | undefined {
    if (!existsSync(join(run, 'ssh_config')) || !existsSync(join(run, 'known_hosts.smoke'))) {
        return 'start the test hosts with tools/test-hosts/up.sh';
    }
    return existsSync(join(resources, 'daemon/manifest.json')) ? undefined : 'build the daemons with pnpm build:daemon';
}

/** A connected test host, with its daemon installed under a scratch root that {@link closeLiveHosts} removes. */
export class LiveHost {
    readonly alias: string;
    readonly root: string;
    readonly connection: HostConnection;
    readonly states: ConnectionState[] = [];
    /** The known-hosts file this host's ssh uses, which names its ssh process uniquely (`pkill -f`). */
    readonly knownHosts: string;
    readonly #watchers = new Set<(message: ServerMessage, at: number) => void>();
    readonly #streams = new Map<number, StreamBuffer>();

    /**
     * A host connection for `alias` whose daemon installs under `~/<root>`, from the app's bundled daemons or those in
     * `daemons`; call `connection.connect()` next.
     */
    constructor(alias: string, root: string, options: LiveOptions = {}) {
        this.alias = alias;
        this.root = root;
        const connectionRuntime = runtime(options.env, options.daemons);
        this.knownHosts = connectionRuntime.seam?.knownHosts ?? '';
        this.connection = new HostConnection(
            connectionRuntime,
            alias,
            { destination: alias, installRoot: `~/${root}` },
            {
                state: (state) => this.states.push(state),
                message: (message) => this.#onMessage(message),
                output: (stream, data) => this.#onOutput(stream, data),
            },
        );
    }

    /** Resolves with the time the first server message matching `match` arrives. */
    message(match: (message: ServerMessage) => boolean, timeoutMs = 30_000): Promise<number> {
        return new Promise((done, fail) => {
            const watcher = (incoming: ServerMessage, at: number): void => {
                if (match(incoming)) {
                    clearTimeout(timer);
                    this.#watchers.delete(watcher);
                    done(at);
                }
            };
            const timer = setTimeout(() => {
                this.#watchers.delete(watcher);
                fail(new Error(`no matching message within ${timeoutMs} ms`));
            }, timeoutMs);
            this.#watchers.add(watcher);
        });
    }

    /** Sends a request and resolves with the first reply of type `reply` that matches. */
    async request<T extends ServerMessage['type']>(
        outgoing: ClientMessage,
        reply: T,
        match: (message: Extract<ServerMessage, { type: T }>) => boolean = () => true,
    ): Promise<Reply<T>> {
        let found: Extract<ServerMessage, { type: T }> | undefined;
        const wanted = (incoming: ServerMessage): incoming is Extract<ServerMessage, { type: T }> =>
            incoming.type === reply && match(incoming as Extract<ServerMessage, { type: T }>);
        const arrived = this.message((incoming) => {
            found = wanted(incoming) ? incoming : found;
            return wanted(incoming);
        });
        this.connection.send(outgoing);
        const at = await arrived;
        if (found === undefined) {
            throw new Error(`no ${reply} reply`);
        }
        return { message: found, at };
    }

    /** Creates a session, attaches it, and returns once its shell printed something. */
    async session(spec: Partial<CreateSessionSpec> = {}): Promise<LiveSession> {
        const create = { type: 'create', requestId: nextRequest++, spec: { ...DEFAULT_SPEC, ...spec } } as const;
        const created = await this.request(create, 'created', (reply) => reply.requestId === create.requestId);
        const id = created.message.session.id;
        const attach = { type: 'attach', requestId: nextRequest++, session: id, mode: 'full' } as const;
        const attached = await this.request(attach, 'attached', (reply) => reply.requestId === attach.requestId);
        const { stream } = attached.message;
        const buffer = this.#bufferOf(stream);
        await waitFor(() => buffer.bytes > 0);
        return this.#liveSession(id, stream);
    }

    /**
     * Attaches to a session that already runs, from `fromOffset` when given (a reconnect, US-2.2.2), and returns once
     * the daemon answered.
     */
    async attach(id: string, fromOffset?: number): Promise<LiveSession> {
        const request = { type: 'attach', requestId: nextRequest++, session: id, mode: 'full' } as const;
        const attach = fromOffset === undefined ? request : { ...request, fromOffset };
        const attached = await this.request(attach, 'attached', (reply) => reply.requestId === attach.requestId);
        const session = this.#liveSession(id, attached.message.stream);
        const { replay } = attached.message;
        return replay === undefined ? session : { ...session, replay };
    }

    /** The offset of the next output byte on a stream, once the daemon said where its output stood (protocol 2). */
    offsetOf(stream: number): number | undefined {
        return this.#bufferOf(stream).offset;
    }

    /** The last 64 KiB received on a stream. */
    tailOf(stream: number): string {
        return this.#bufferOf(stream).tail;
    }

    #liveSession(id: string, stream: number): LiveSession {
        const buffer = this.#bufferOf(stream);
        return {
            id,
            stream,
            type: (text) => this.connection.input(stream, Buffer.from(text)),
            next: (text, timeoutMs) => buffer.next(text, timeoutMs),
            received: () => buffer.bytes,
            tail: () => buffer.tail,
        };
    }

    #onMessage(message: ServerMessage): void {
        const at = performance.now();
        if (message.type === 'synced') {
            this.#bufferOf(message.stream).synced(message.offset);
        }
        for (const watcher of [...this.#watchers]) {
            watcher(message, at);
        }
    }

    #onOutput(stream: number, data: Uint8Array): void {
        this.#bufferOf(stream).push(Buffer.from(data).toString('utf8'), performance.now(), data.length);
        this.connection.credit(stream, data.length);
    }

    #bufferOf(stream: number): StreamBuffer {
        const buffer = this.#streams.get(stream) ?? new StreamBuffer();
        this.#streams.set(stream, buffer);
        return buffer;
    }
}

const DEFAULT_SPEC: CreateSessionSpec = { env: {}, size: { cols: 120, rows: 40 } };
const opened: LiveHost[] = [];
let nextRequest = 1;

/** How a live host connects: the environment ssh gets, the daemons to install, and the install root to reuse. */
export interface LiveOptions {
    readonly env?: Readonly<Record<string, string | undefined>>;
    /** A folder holding `manifest.json` and each platform's `trcd`, like the app's `resources/daemon`. */
    readonly daemons?: string;
    /** The install root under the home folder; a fresh one when absent. */
    readonly root?: string;
}

/** Connects `alias` and returns once the daemon answers; a fresh install unless `options.root` names one. */
export async function connectLive(alias: string, options: LiveOptions = {}): Promise<LiveHost> {
    const host = new LiveHost(alias, options.root ?? `.trc-nfr-${randomBytes(4).toString('hex')}`, options);
    opened.push(host);
    await host.connection.connect();
    await waitFor(() => ['connected', 'failed', 'host-key'].includes(host.states.at(-1)?.status ?? ''), 120_000);
    if (host.states.at(-1)?.status !== 'connected') {
        throw new Error(`${alias} did not connect: ${JSON.stringify(host.states.at(-1))}`);
    }
    return host;
}

/** Restarts a test host's container, which ends every process in it as a reboot does (P-50). */
export function restartTestHost(alias: string): void {
    const context = process.env['DOCKER_CONTEXT'] ?? 'colima-trc';
    const container = `trc-test-hosts-${alias.replace(/^trc-/, '')}-1`;
    execFileSync('docker', ['--context', context, 'restart', '--time', '1', container], {
        stdio: 'ignore',
        timeout: 60_000,
    });
}

/** Connects `alias` to the install at `root` again, retrying for a minute while a restarted host's sshd comes up. */
export async function reconnectLive(alias: string, root: string): Promise<LiveHost> {
    const started = performance.now();
    for (;;) {
        try {
            return await connectLive(alias, { root });
        } catch (error) {
            if (performance.now() - started > 60_000) {
                throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
    }
}

/** Closes every live host and removes its install. */
export function closeLiveHosts(): void {
    for (const host of opened.splice(0)) {
        host.connection.close();
        removeInstall(host);
    }
}

/** The median time from a ping to its pong over the host's SSH channel: the SSH round trip NFR-02 is measured against. */
export async function sshRoundTrip(host: LiveHost, samples = 20): Promise<number> {
    return percentile(await roundTrips(host, samples), 50);
}

/** `samples` times from a ping to its pong over the host's SSH channel, each ping sent `gapMs` after the last pong. */
export async function roundTrips(host: LiveHost, samples: number, gapMs = 0): Promise<readonly number[]> {
    const times: number[] = [];
    for (let requestId = 900_000; requestId < 900_000 + samples; requestId += 1) {
        const sent = performance.now();
        const { at } = await host.request(
            { type: 'ping', requestId },
            'pong',
            (reply) => reply.requestId === requestId,
        );
        times.push(at - sent);
        await new Promise((done) => setTimeout(done, gapMs));
    }
    return times;
}

/** Runs `script` on `alias` over a plain ssh connection and returns its stdout, without the hosts' login banner. */
export function ssh(alias: string, script: string): string {
    const known = `UserKnownHostsFile=${join(run, 'known_hosts.smoke')}`;
    const args = ['-F', join(run, 'ssh_config'), '-o', 'BatchMode=yes', '-o', known, alias, script];
    const out = execFileSync('ssh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out
        .split('\n')
        .filter((line) => !line.startsWith(LOGIN_BANNER))
        .join('\n');
}

/** Resolves once `condition` holds, polling every 20 ms. */
export async function waitFor(condition: () => boolean, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!condition()) {
        if (Date.now() > deadline) {
            throw new Error('timed out waiting');
        }
        await new Promise((done) => setTimeout(done, 20));
    }
}

/** Stops the daemon under the host's scratch root and removes it; `[/]` keeps pkill off the shell running it. */
function removeInstall(host: LiveHost): void {
    const script = `kill $(head -n 1 ~/${host.root}/run/core.lock 2>/dev/null) 2>/dev/null; pkill -f "[/]${host.root}/versions"; rm -rf ~/${host.root}`;
    try {
        ssh(host.alias, script);
    } catch {
        return;
    }
}

/** A session's received output: a bounded tail, the byte count, and waiters for text that arrives later. */
class StreamBuffer {
    bytes = 0;
    #raw = 0;
    #synced: { readonly offset: number; readonly raw: number } | undefined;
    #tail = '';
    #waiters: { readonly text: string; readonly from: number; readonly done: (at: number) => void }[] = [];

    get tail(): string {
        return this.#tail;
    }

    /** The offset of the next byte, counted from the last `synced`. */
    get offset(): number | undefined {
        return this.#synced === undefined ? undefined : this.#synced.offset + this.#raw - this.#synced.raw;
    }

    synced(offset: number): void {
        this.#synced = { offset, raw: this.#raw };
    }

    push(text: string, at: number, raw: number): void {
        this.#raw += raw;
        this.bytes += text.length;
        this.#tail = (this.#tail + text).slice(-TAIL);
        for (const waiter of [...this.#waiters]) {
            const fresh = this.#tail.slice(Math.max(0, this.#tail.length - (this.bytes - waiter.from)));
            if (fresh.includes(waiter.text)) {
                this.#waiters.splice(this.#waiters.indexOf(waiter), 1);
                waiter.done(at);
            }
        }
    }

    next(text: string, timeoutMs = 30_000): Promise<number> {
        return new Promise((done, fail) => {
            const waiter = {
                text,
                from: this.bytes,
                done: (at: number) => {
                    clearTimeout(timer);
                    done(at);
                },
            };
            const timer = setTimeout(() => {
                this.#waiters.splice(this.#waiters.indexOf(waiter), 1);
                const tail = JSON.stringify(this.#tail.slice(-400));
                fail(new Error(`no ${JSON.stringify(text)} within ${timeoutMs} ms; output ended ${tail}`));
            }, timeoutMs);
            this.#waiters.push(waiter);
        });
    }
}

function runtime(
    env: Readonly<Record<string, string | undefined>> = process.env,
    daemons = join(resources, 'daemon'),
): ConnectionRuntime {
    const knownHosts = join(mkdtempSync(join(scratch, 'kh-')), 'known_hosts');
    copyFileSync(join(run, 'known_hosts.smoke'), knownHosts);
    const manifest = parseDaemonManifest(readFileSync(join(daemons, 'manifest.json'), 'utf8'));
    return {
        ssh: '/usr/bin/ssh',
        helpers: { askpass: join(resources, 'bin/askpass'), knownHosts: join(resources, 'bin/known-hosts') },
        seam: { sshConfig: join(run, 'ssh_config'), knownHosts },
        env,
        runDir: mkdtempSync(join(scratch, 'run-')),
        appVersion: manifest.version,
        bootstrapTemplate: readFileSync(join(resources, 'bin/bootstrap.sh'), 'utf8'),
        manifest,
        readBinary: async (platform) => readFile(join(daemons, platform, 'trcd')),
        log: createAppLogger(APP_LOGS),
    };
}
