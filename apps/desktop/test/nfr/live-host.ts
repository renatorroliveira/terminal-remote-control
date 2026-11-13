import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ClientMessage, CreateSessionSpec, ServerMessage } from '@trc/protocol';
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
    readonly #watchers = new Set<(message: ServerMessage, at: number) => void>();
    readonly #streams = new Map<number, StreamBuffer>();

    /** A host connection for `alias` whose daemon installs under `~/<root>`; call `connection.connect()` next. */
    constructor(alias: string, root: string, env?: Readonly<Record<string, string | undefined>>) {
        this.alias = alias;
        this.root = root;
        this.connection = new HostConnection(
            runtime(env),
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
        return {
            id,
            stream,
            type: (text) => this.connection.input(stream, Buffer.from(text)),
            next: (text, timeoutMs) => buffer.next(text, timeoutMs),
            received: () => buffer.bytes,
        };
    }

    #onMessage(message: ServerMessage): void {
        const at = performance.now();
        for (const watcher of [...this.#watchers]) {
            watcher(message, at);
        }
    }

    #onOutput(stream: number, data: Uint8Array): void {
        this.#bufferOf(stream).push(Buffer.from(data).toString('utf8'), performance.now());
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

/** Connects `alias` with a fresh install and returns once the daemon answers. */
export async function connectLive(
    alias: string,
    env?: Readonly<Record<string, string | undefined>>,
): Promise<LiveHost> {
    const host = new LiveHost(alias, `.trc-nfr-${randomBytes(4).toString('hex')}`, env);
    opened.push(host);
    await host.connection.connect();
    await waitFor(() => ['connected', 'failed', 'host-key'].includes(host.states.at(-1)?.status ?? ''), 120_000);
    if (host.states.at(-1)?.status !== 'connected') {
        throw new Error(`${alias} did not connect: ${JSON.stringify(host.states.at(-1))}`);
    }
    return host;
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
    const times: number[] = [];
    for (let requestId = 900_000; requestId < 900_000 + samples; requestId += 1) {
        const sent = performance.now();
        const { at } = await host.request(
            { type: 'ping', requestId },
            'pong',
            (reply) => reply.requestId === requestId,
        );
        times.push(at - sent);
    }
    return percentile(times, 50);
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
    const script = `kill $(cat ~/${host.root}/run/core.lock 2>/dev/null) 2>/dev/null; pkill -f "[/]${host.root}/versions"; rm -rf ~/${host.root}`;
    try {
        ssh(host.alias, script);
    } catch {
        return;
    }
}

/** A session's received output: a bounded tail, the byte count, and waiters for text that arrives later. */
class StreamBuffer {
    bytes = 0;
    #tail = '';
    #waiters: { readonly text: string; readonly from: number; readonly done: (at: number) => void }[] = [];

    push(text: string, at: number): void {
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

function runtime(env: Readonly<Record<string, string | undefined>> = process.env): ConnectionRuntime {
    const knownHosts = join(mkdtempSync(join(scratch, 'kh-')), 'known_hosts');
    copyFileSync(join(run, 'known_hosts.smoke'), knownHosts);
    const manifest = parseDaemonManifest(readFileSync(join(resources, 'daemon/manifest.json'), 'utf8'));
    return {
        ssh: '/usr/bin/ssh',
        helpers: { askpass: join(resources, 'bin/askpass'), knownHosts: join(resources, 'bin/known-hosts') },
        seam: { sshConfig: join(run, 'ssh_config'), knownHosts },
        env,
        runDir: mkdtempSync(join(scratch, 'run-')),
        appVersion: manifest.version,
        bootstrapTemplate: readFileSync(join(resources, 'bin/bootstrap.sh'), 'utf8'),
        manifest,
        readBinary: async (platform) => readFile(join(resources, 'daemon', platform, 'trcd')),
        log: createAppLogger(APP_LOGS),
    };
}
