import { randomBytes } from 'node:crypto';
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
import type { SshHelpers, TestSeam } from '../ssh/arguments';
import type { HelperLine } from '../ssh/helper-lines';
import { onLocalClock } from './daemon-details';
import { fromBootstrap } from './failures';
import { writeInputFrames } from './input-frames';
import { type LifecycleEvent, reduceConnection } from './lifecycle';
import { LocalTransport } from './local-transport';
import { Pinger } from './pinger';
import { SshTransport } from './ssh-transport';
import type { Channel, Transport } from './transport';

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
    /** The home folder This computer's daemon gets; a scratch one in test builds (P-58), the user's otherwise. */
    readonly localHome?: string | undefined;
}

type Answer = Extract<ServerMessage, { type: 'welcome' | 'incompatible' }>;

/** The first protocol whose cores stop every session and delete their data before a removal (US-3.3.3). */
const REMOVING_PROTOCOL = 3;
/** The request ID of `removeDaemon`, among those the renderer never uses. */
const REMOVAL_REQUEST_ID = 0xffff_ffff;
/** How long a core may take to stop every session before the removal goes on without it. */
const STOP_SESSIONS_TIMEOUT_MS = 60_000;

/** How long the daemon has to answer `hello`. */
const HANDSHAKE_TIMEOUT_MS = 15_000;

/**
 * One host's connection: one channel carrying every session, over SSH for a remote host (US-1.5) or a local shell
 * for This computer (P-59). It checks the client, asks about unknown host keys, explains failures, installs and
 * starts the daemon, and then relays protocol frames with application pings for liveness (NFR-07).
 */
export class HostConnection implements HostConnectionLike {
    readonly #runtime: ConnectionRuntime;
    readonly #hostId: string;
    readonly #target: ConnectTarget;
    readonly #listener: ConnectionListener;
    readonly #transport: Transport;
    #state: ConnectionState = { status: 'idle' };
    #process: Channel | undefined;
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
        this.#transport =
            target.local === true
                ? new LocalTransport({ env: runtime.env, home: runtime.localHome })
                : new SshTransport(runtime, target, (line) => this.#onHelper(line));
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
        if (state.status !== 'host-key' || state.key.fingerprint !== fingerprint) {
            this.#runtime.log.warn('host key acceptance ignored', { hostId: this.#hostId });
            return;
        }
        if (!(await this.#transport.acceptHostKey(state.key))) {
            this.#runtime.log.warn('host key acceptance ignored', { hostId: this.#hostId });
            return;
        }
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
        const clientProblem = await this.#transport.check();
        if (clientProblem !== undefined) {
            return { kind: 'failed', failure: clientProblem };
        }
        const opened = await this.#open();
        if ('failure' in opened) {
            return { kind: 'failed', failure: opened.failure };
        }
        const bootNonce = randomBytes(8).toString('hex');
        const outcome = await runRemoval(
            { input: opened.child.stdin, output: opened.child.stdout },
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

    /** Why a removal stopped: what the host said, or, when the channel itself ended, what its errors mean. */
    async #failureOf(failure: BootstrapFailure, channel: Channel): Promise<ConnectionFailure> {
        if (failure.kind !== 'closed') {
            return fromBootstrap(failure);
        }
        const closed = await this.#transport.closed(channel);
        return closed.kind === 'host-key-unknown'
            ? { kind: 'other', details: 'connect to the host first to trust its key' }
            : closed;
    }

    /** Starts the transport's channel. */
    async #open(): Promise<Channel | { readonly failure: ConnectionFailure }> {
        const opened = await this.#transport.open();
        if (!('failure' in opened)) {
            this.#process = opened;
        }
        return opened;
    }

    async #attempt(): Promise<void> {
        const clientProblem = await this.#transport.check();
        if (clientProblem !== undefined) {
            return this.#fail(clientProblem);
        }
        const opened = await this.#open();
        if ('failure' in opened) {
            return this.#fail(opened.failure);
        }
        const runtime = this.#runtime;
        const bootNonce = randomBytes(8).toString('hex');
        const outcome = await runBootstrap(
            { input: opened.child.stdin, output: opened.child.stdout },
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
        await this.#afterBootstrap(outcome, opened);
    }

    async #afterBootstrap(outcome: BootstrapOutcome, process: Channel): Promise<void> {
        if (outcome.kind === 'running') {
            return this.#handshake(process, outcome.remainder);
        }
        if (outcome.failure.kind !== 'closed') {
            process.child.kill();
            return this.#fail(fromBootstrap(outcome.failure));
        }
        const closed = await this.#transport.closed(process);
        if (closed.kind === 'host-key-unknown') {
            this.#dispatch({ type: 'host-key', key: closed.key });
            return;
        }
        this.#fail(closed);
    }

    async #handshake(process: Channel, remainder: Uint8Array): Promise<void> {
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

    #readFrames(process: Channel, remainder: Uint8Array): void {
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

    #onChannelClosed(process: Channel): void {
        if (this.#process !== process) {
            return;
        }
        this.#pinger?.stop();
        this.#answer?.(undefined);
        this.#stopped?.();
        this.#dispatch({ type: 'lost', reason: 'channel-closed' });
    }

    #startPinger(process: Channel): void {
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
        await this.#transport.dispose();
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
