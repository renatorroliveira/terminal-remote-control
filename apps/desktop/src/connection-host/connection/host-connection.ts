import { randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
    type ClientMessage,
    decodeServerMessage,
    encodeClientMessage,
    encodeCredit,
    type Frame,
    FrameDecoder,
    FrameKind,
    MIN_PROTOCOL_VERSION,
    PROTOCOL_VERSION,
    type ServerMessage,
} from '@trc/protocol';
import {
    type ConnectionFailure,
    type ConnectionState,
    type ConnectTarget,
    type DaemonRemoval,
    RESERVED_REQUEST_IDS,
} from '../../shared/connection';
import { type BootstrapFailure, type BootstrapOutcome, runBootstrap, runRemoval } from '../bootstrap/driver';
import type { DaemonManifest, DaemonPlatform } from '../bootstrap/manifest';
import { buildBootstrapScript } from '../bootstrap/script';
import type { AppLogger } from '../logging/app-log';
import type { ConnectionListener, HostConnectionLike } from '../port/router';
import {
    effectiveConfigArguments,
    type SshHelpers,
    sshArguments,
    sshEnvironment,
    type TestSeam,
    wrapperConfig,
} from '../ssh/arguments';
import { classifyFailure, diagnoseAuthentication } from '../ssh/classify';
import { type EffectiveConfig, supportsKnownHostsCommand } from '../ssh/client-checks';
import type { HelperLine } from '../ssh/helper-lines';
import { appendKnownHost, fingerprintOf, knownHostsLine } from '../ssh/known-hosts';
import { onLocalClock } from './daemon-details';
import { fromBootstrap, fromSsh } from './failures';
import { writeInputFrames } from './input-frames';
import { type LifecycleEvent, reduceConnection } from './lifecycle';
import { Pinger } from './pinger';
import { type SshProcess, startSsh } from './ssh-process';
import { createAuthProbes, expandHome, readEffectiveConfig, readSshVersion } from './ssh-tools';

/** What every connection shares: the local ssh, the app's helpers and bundle, and the log. */
export interface ConnectionRuntime {
    /** The system OpenSSH client, by absolute path. */
    readonly ssh: string;
    readonly helpers: SshHelpers;
    /** The P-14 test seam; always `undefined` in release builds. */
    readonly seam: TestSeam | undefined;
    /** The environment ssh inherits, including `SSH_AUTH_SOCK`. */
    readonly env: Readonly<Record<string, string | undefined>>;
    /** A private directory for the per-connection wrapper configs. */
    readonly runDir: string;
    readonly appVersion: string;
    readonly bootstrapTemplate: string;
    readonly manifest: DaemonManifest;
    readonly readBinary: (platform: DaemonPlatform) => Promise<Uint8Array>;
    readonly log: AppLogger;
}

type Answer = Extract<ServerMessage, { type: 'welcome' | 'incompatible' }>;

/** An ssh process running the bootstrap's remote command, with the settings and nonce it started with. */
interface OpenedSsh {
    readonly process: SshProcess;
    readonly config: EffectiveConfig;
    readonly nonce: string;
}

/** The first protocol whose cores stop every session and delete their data before a removal (US-3.3.3). */
const REMOVING_PROTOCOL = 3;
/** The request ID of `removeDaemon`, among those the renderer never uses. */
const REMOVAL_REQUEST_ID = 0xffff_ffff;
/** How long a core may take to stop every session before the removal goes on without it. */
const STOP_SESSIONS_TIMEOUT_MS = 60_000;

/** How long the daemon has to answer `hello`. */
const HANDSHAKE_TIMEOUT_MS = 15_000;
const REMOTE_COMMAND = 'exec /bin/sh -s';

/**
 * One host's connection: one ssh process and one exec channel carrying every session (US-1.5). It checks the
 * client, asks about unknown host keys, explains failures, installs and starts the daemon, and then relays
 * protocol frames with application pings for liveness (NFR-07).
 */
export class HostConnection implements HostConnectionLike {
    readonly #runtime: ConnectionRuntime;
    readonly #hostId: string;
    readonly #target: ConnectTarget;
    readonly #listener: ConnectionListener;
    #state: ConnectionState = { status: 'idle' };
    #config: EffectiveConfig | undefined;
    #process: SshProcess | undefined;
    #wrapper: string | undefined;
    #pinger: Pinger | undefined;
    #answer: ((answer: Answer | undefined) => void) | undefined;
    /** Resolves once the core answered `removeDaemon` or the channel closed. */
    #stopped: (() => void) | undefined;

    /** Creates an idle connection to `target`, reporting to `listener`. */
    constructor(runtime: ConnectionRuntime, hostId: string, target: ConnectTarget, listener: ConnectionListener) {
        this.#runtime = runtime;
        this.#hostId = hostId;
        this.#target = target;
        this.#listener = listener;
    }

    /** The current lifecycle state. */
    get state(): ConnectionState {
        return this.#state;
    }

    /** Connects, or reconnects after a failure or loss. Resolves once the connection settles. */
    async connect(): Promise<void> {
        if (!this.#dispatch({ type: 'connect' })) {
            return;
        }
        await this.#teardown();
        try {
            await this.#attempt();
        } catch (error) {
            this.#fail({ kind: 'other', details: errorText(error) });
        }
    }

    /** Sends a control message; `false` when not connected. */
    send(message: ClientMessage): boolean {
        return this.#state.status === 'connected' && this.#write(encodeClientMessage(message));
    }

    /** Sends input on a session stream; `false` when not connected, so the caller can say input was not sent. */
    input(stream: number, data: Uint8Array): boolean {
        if (this.#state.status !== 'connected') {
            return false;
        }
        return writeInputFrames(stream, data, (frame) => this.#write(frame));
    }

    /** Grants output credit on a session stream. */
    credit(stream: number, bytes: number): boolean {
        return this.#state.status === 'connected' && this.#write(encodeCredit(stream, bytes));
    }

    /**
     * Records the key the user accepted in known_hosts, hashed when ssh hashes, and connects again. Only the key
     * this connection was presented can be accepted.
     */
    async acceptHostKey(fingerprint: string): Promise<void> {
        const state = this.#state;
        if (state.status !== 'host-key' || state.key.fingerprint !== fingerprint || this.#config === undefined) {
            this.#runtime.log.warn('host key acceptance ignored', { hostId: this.#hostId });
            return;
        }
        const file = expandHome(this.#config.knownHostsFiles[0] ?? '~/.ssh/known_hosts');
        await appendKnownHost(file, knownHostsLine(state.key, { hashed: this.#config.hashKnownHosts }));
        this.#runtime.log.info('host key accepted', { hostId: this.#hostId, fingerprint });
        await this.connect();
    }

    /** Aborts after the user rejects a host key (US-1.2.1). */
    rejectHostKey(): void {
        if (this.#state.status === 'host-key') {
            this.#fail({ kind: 'host-key-rejected', host: this.#state.key.host, details: '' });
        }
    }

    /** Checks at once that a connected daemon still answers, after a wake or a network change (NFR-07). */
    checkAlive(): void {
        this.#pinger?.checkNow();
    }

    /** Closes the connection for good. */
    close(): void {
        this.#dispatch({ type: 'close' });
        void this.#teardown();
    }

    /**
     * Has a connected core from protocol 3 on stop every session, with `graceMs` between the stop signals, and delete
     * their data; then closes the connection and removes the daemon over a new exec channel: the bootstrap's `REMOVE`
     * step ends its processes and deletes only what TRC wrote in the install location (US-3.3.3, P-46). It works
     * whether or not the daemon still answers.
     */
    async removeDaemon(graceMs?: number): Promise<DaemonRemoval> {
        await this.#stopSessions(graceMs);
        this.close();
        try {
            return await this.#remove();
        } catch (error) {
            return { kind: 'failed', failure: { kind: 'other', details: errorText(error) } };
        } finally {
            await this.#teardown();
        }
    }

    /** Asks the core to stop every session and waits until it answered, its channel closed, or a minute passed. */
    async #stopSessions(graceMs: number | undefined): Promise<void> {
        const state = this.#state;
        if (state.status !== 'connected' || state.daemon.proto < REMOVING_PROTOCOL) {
            return;
        }
        const stopped = new Promise<void>((resolve) => {
            this.#stopped = resolve;
        });
        const timer = setTimeout(() => this.#stopped?.(), STOP_SESSIONS_TIMEOUT_MS);
        this.send({
            type: 'removeDaemon',
            requestId: REMOVAL_REQUEST_ID,
            ...(graceMs === undefined ? {} : { graceMs }),
        });
        await stopped;
        clearTimeout(timer);
        this.#stopped = undefined;
    }

    async #remove(): Promise<DaemonRemoval> {
        const clientProblem = await this.#checkClient();
        if (clientProblem !== undefined) {
            return { kind: 'failed', failure: clientProblem };
        }
        const opened = await this.#open();
        if ('failure' in opened) {
            return { kind: 'failed', failure: opened.failure };
        }
        const bootNonce = randomBytes(8).toString('hex');
        const outcome = await runRemoval(
            { input: opened.process.child.stdin, output: opened.process.child.stdout },
            {
                script: buildBootstrapScript(this.#runtime.bootstrapTemplate, {
                    nonce: bootNonce,
                    root: this.#target.installRoot,
                }),
                nonce: bootNonce,
            },
        );
        if (outcome.kind === 'removed') {
            this.#runtime.log.info('daemon removed', { hostId: this.#hostId, kept: outcome.kept.length });
            return outcome;
        }
        return { kind: 'failed', failure: await this.#failureOf(outcome.failure, opened) };
    }

    /** Why a removal stopped: what the host said, or, when ssh itself ended, what its errors mean. */
    async #failureOf(failure: BootstrapFailure, { process, config, nonce }: OpenedSsh): Promise<ConnectionFailure> {
        if (failure.kind !== 'closed') {
            return fromBootstrap(failure);
        }
        await process.exited;
        const classified = classifyFailure(process.stderr, nonce, config);
        return classified.kind === 'host-key-unknown'
            ? { kind: 'other', details: 'connect to the host first to trust its key' }
            : fromSsh(classified, undefined);
    }

    /** Reads the host's effective SSH settings and starts ssh with the bootstrap's remote command. */
    async #open(): Promise<OpenedSsh | { readonly failure: ConnectionFailure }> {
        const runtime = this.#runtime;
        const wrapper = await this.#writeWrapper();
        const config = await readEffectiveConfig(
            runtime.ssh,
            effectiveConfigArguments(wrapper, this.#target),
            runtime.env,
        );
        if (config === undefined) {
            return { failure: { kind: 'other', details: 'ssh could not read the SSH configuration for this host' } };
        }
        this.#config = config;
        const nonce = randomBytes(8).toString('hex');
        const process = startSsh({
            program: runtime.ssh,
            args: sshArguments({
                wrapper,
                helpers: runtime.helpers,
                target: this.#target,
                command: REMOTE_COMMAND,
                seam: runtime.seam,
            }),
            env: sshEnvironment(runtime.env, runtime.helpers, nonce),
            nonce,
            onHelper: (line) => this.#onHelper(line),
        });
        this.#process = process;
        return { process, config, nonce };
    }

    async #attempt(): Promise<void> {
        const clientProblem = await this.#checkClient();
        if (clientProblem !== undefined) {
            return this.#fail(clientProblem);
        }
        const opened = await this.#open();
        if ('failure' in opened) {
            return this.#fail(opened.failure);
        }
        const { process, config, nonce: sshNonce } = opened;
        const runtime = this.#runtime;
        const bootNonce = randomBytes(8).toString('hex');
        const outcome = await runBootstrap(
            { input: process.child.stdin, output: process.child.stdout },
            {
                script: buildBootstrapScript(runtime.bootstrapTemplate, {
                    nonce: bootNonce,
                    root: this.#target.installRoot,
                }),
                nonce: bootNonce,
                manifest: runtime.manifest,
                readBinary: runtime.readBinary,
                onStep: (step) => this.#dispatch({ type: 'step', step }),
            },
        );
        await this.#afterBootstrap(outcome, process, config, sshNonce);
    }

    async #checkClient(): Promise<ConnectionFailure | undefined> {
        const version = await readSshVersion(this.#runtime.ssh, this.#runtime.env);
        if (version === 'missing' || version === undefined) {
            return { kind: 'ssh-missing', details: '' };
        }
        return supportsKnownHostsCommand(version)
            ? undefined
            : { kind: 'ssh-too-old', version: `${version.major}.${version.minor}`, details: '' };
    }

    async #writeWrapper(): Promise<string> {
        await mkdir(this.#runtime.runDir, { recursive: true, mode: 0o700 });
        const file = join(this.#runtime.runDir, `ssh-${randomBytes(8).toString('hex')}.conf`);
        await writeFile(file, wrapperConfig({ helpers: this.#runtime.helpers, seam: this.#runtime.seam }), {
            mode: 0o600,
        });
        this.#wrapper = file;
        return file;
    }

    async #afterBootstrap(
        outcome: BootstrapOutcome,
        process: SshProcess,
        config: EffectiveConfig,
        nonce: string,
    ): Promise<void> {
        if (outcome.kind === 'running') {
            return this.#handshake(process, outcome.remainder);
        }
        if (outcome.failure.kind !== 'closed') {
            process.child.kill();
            return this.#fail(fromBootstrap(outcome.failure));
        }
        await process.exited;
        const failure = classifyFailure(process.stderr, nonce, config);
        if (failure.kind === 'host-key-unknown') {
            this.#dispatch({ type: 'host-key', key: { ...failure.key, fingerprint: fingerprintOf(failure.key.key) } });
            return;
        }
        const probes = createAuthProbes(dirname(this.#runtime.ssh), this.#runtime.env);
        const cause = failure.kind === 'authentication' ? await diagnoseAuthentication(config, probes) : undefined;
        this.#fail(fromSsh(failure, cause));
    }

    async #handshake(process: SshProcess, remainder: Uint8Array): Promise<void> {
        this.#dispatch({ type: 'step', step: 'handshake' });
        let deadline: ReturnType<typeof setTimeout> | undefined;
        const answered = new Promise<Answer | undefined>((resolve) => {
            this.#answer = resolve;
            deadline = setTimeout(() => resolve(undefined), HANDSHAKE_TIMEOUT_MS);
        }).finally(() => clearTimeout(deadline));
        this.#readFrames(process, remainder);
        this.#write(
            encodeClientMessage({
                type: 'hello',
                minProto: MIN_PROTOCOL_VERSION,
                maxProto: PROTOCOL_VERSION,
                appVersion: this.#runtime.appVersion,
                caps: [],
            }),
        );
        const answer = await answered;
        this.#answer = undefined;
        if (answer?.type === 'welcome') {
            this.#dispatch({
                type: 'connected',
                daemon: {
                    version: answer.daemonVersion,
                    sha256: answer.binarySha256,
                    proto: answer.proto,
                    ...(answer.service === undefined ? {} : { service: answer.service }),
                    ...(answer.details === undefined ? {} : { details: onLocalClock(answer.details, Date.now()) }),
                    bundled: this.#runtime.manifest.version,
                },
            });
            return this.#startPinger(process);
        }
        process.child.kill();
        this.#fail(
            answer?.type === 'incompatible'
                ? { kind: 'incompatible', minProto: answer.minProto, maxProto: answer.maxProto, details: '' }
                : { kind: 'other', details: 'the daemon did not answer the handshake' },
        );
    }

    #readFrames(process: SshProcess, remainder: Uint8Array): void {
        const decoder = new FrameDecoder();
        const onData = (chunk: Uint8Array): void => {
            try {
                for (const frame of decoder.push(chunk)) {
                    this.#onFrame(frame);
                }
            } catch {
                this.#runtime.log.warn('malformed frame', { hostId: this.#hostId });
                process.child.kill();
            }
        };
        process.child.stdout.on('data', onData);
        process.child.stdout.resume();
        void process.exited.then(() => this.#onChannelClosed(process));
        if (remainder.length > 0) {
            onData(remainder);
        }
    }

    #onFrame(frame: Frame): void {
        if (frame.kind === FrameKind.Output) {
            this.#listener.output(frame.stream, frame.payload);
            return;
        }
        if (frame.kind !== FrameKind.Control) {
            return;
        }
        const decoded = decodeServerMessage(frame.payload);
        if (!decoded.ok) {
            this.#runtime.log.warn('malformed control message', { hostId: this.#hostId });
            return;
        }
        this.#onMessage(decoded.message);
    }

    #onMessage(message: ServerMessage): void {
        if (message.type === 'welcome' || message.type === 'incompatible') {
            this.#answer?.(message);
        } else if (message.type === 'pong' && message.requestId >= RESERVED_REQUEST_IDS) {
            this.#pinger?.pong(message.requestId);
        } else if ((message.type === 'done' || message.type === 'error') && message.requestId === REMOVAL_REQUEST_ID) {
            this.#stopped?.();
        } else if (this.#state.status === 'connected') {
            this.#listener.message(message);
        }
    }

    #onHelper(line: HelperLine): void {
        if (line.kind === 'notice') {
            this.#dispatch({ type: 'touch', text: line.text });
        }
    }

    #onChannelClosed(process: SshProcess): void {
        if (this.#process !== process) {
            return;
        }
        this.#pinger?.stop();
        this.#answer?.(undefined);
        this.#stopped?.();
        this.#dispatch({ type: 'lost', reason: 'channel-closed' });
    }

    #startPinger(process: SshProcess): void {
        this.#pinger = new Pinger(
            (requestId) => this.#write(encodeClientMessage({ type: 'ping', requestId })),
            () => {
                this.#dispatch({ type: 'lost', reason: 'ping-timeout' });
                process.child.kill();
            },
        );
        this.#pinger.start();
    }

    #write(bytes: Uint8Array): boolean {
        const stdin = this.#process?.child.stdin;
        if (stdin === undefined || stdin.destroyed || !stdin.writable) {
            return false;
        }
        stdin.write(bytes);
        return true;
    }

    async #teardown(): Promise<void> {
        this.#pinger?.stop();
        this.#pinger = undefined;
        const process = this.#process;
        this.#process = undefined;
        process?.child.kill();
        const wrapper = this.#wrapper;
        this.#wrapper = undefined;
        if (wrapper !== undefined) {
            await rm(wrapper, { force: true });
        }
    }

    #fail(failure: ConnectionFailure): void {
        this.#dispatch({ type: 'failed', failure });
    }

    #dispatch(event: LifecycleEvent): boolean {
        const next = reduceConnection(this.#state, event);
        if (next === this.#state) {
            return false;
        }
        this.#state = next;
        this.#runtime.log.info('connection state', {
            hostId: this.#hostId,
            status: next.status,
            step: next.status === 'connecting' ? next.step : undefined,
            failure: next.status === 'failed' ? next.failure.kind : undefined,
            reason: next.status === 'disconnected' ? next.reason : undefined,
        });
        this.#listener.state(next);
        return true;
    }
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
