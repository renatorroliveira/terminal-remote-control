import type { ClientMessage, ServerMessage } from '@trc/protocol';
import type { ConnectionState, ConnectTarget, DaemonRemoval, HostEvent, HostRequest } from '../../shared/connection';
import { type EnableOptions, Reconnector } from '../connection/reconnector';
import type { AppLogger } from '../logging/app-log';
import { OutputBatcher } from './output-batcher';
import { parseHostRequest, requestProblem } from './requests';

/** What a host connection reports. */
export interface ConnectionListener {
    state(state: ConnectionState): void;
    message(message: ServerMessage): void;
    output(stream: number, data: Uint8Array): void;
}

/** The host connection operations the router uses. Each returns `false` when the connection cannot take it. */
export interface HostConnectionLike {
    /** The current lifecycle state. */
    readonly state: ConnectionState;
    connect(): Promise<void>;
    send(message: ClientMessage): boolean;
    input(stream: number, data: Uint8Array): boolean;
    credit(stream: number, bytes: number): boolean;
    acceptHostKey(fingerprint: string): Promise<void>;
    rejectHostKey(): void;
    /** Pings now with a short timeout, so a connection a wake or network change broke is noticed at once. */
    checkAlive(): void;
    close(): void;
    /**
     * Has a connected daemon stop every session, with `graceMs` between the stop signals, then ends the connection
     * and removes the daemon from the host over a new one (US-3.3.3).
     */
    removeDaemon(graceMs?: number): Promise<DaemonRemoval>;
}

/** Creates the connection for a host. */
export type CreateConnection = (
    hostId: string,
    target: ConnectTarget,
    listener: ConnectionListener,
) => HostConnectionLike;

/**
 * Routes validated renderer requests to one connection per host, and posts connection events back: states and
 * control messages at once, terminal output batched, with output always flushed before a control message. Each host
 * the user or the launch connected reconnects by itself after a loss (US-2.2.2), until the user disconnects or stops
 * retrying.
 */
export class ConnectionRouter {
    readonly #post: (event: HostEvent) => void;
    readonly #create: CreateConnection;
    readonly #log: AppLogger;
    readonly #localRoot: string | undefined;
    readonly #connections = new Map<string, HostConnectionLike>();
    readonly #reconnectors = new Map<string, Reconnector>();
    readonly #batcher: OutputBatcher;

    /**
     * Creates a router posting with `post` and making connections with `create`; `localRoot` is This computer's
     * install location, the one local target it takes (US-4.2.4).
     */
    constructor(
        post: (event: HostEvent) => void,
        create: CreateConnection,
        log: AppLogger,
        localRoot: string | undefined,
    ) {
        this.#post = post;
        this.#create = create;
        this.#log = log;
        this.#localRoot = localRoot;
        this.#batcher = new OutputBatcher((hostId, stream, data) => post({ type: 'output', hostId, stream, data }));
    }

    /** After a wake or a network change: reconnects every waiting host now and checks every connected one (US-2.2.2). */
    retryAll(): void {
        for (const [hostId, connection] of this.#connections) {
            this.#reconnectors.get(hostId)?.retryNow();
            if (connection.state.status === 'connected') {
                connection.checkAlive();
            }
        }
    }

    /** Handles one message from the renderer. */
    handle(raw: unknown): void {
        const request = parseHostRequest(raw, this.#localRoot);
        if (request === undefined) {
            this.#log.warn('invalid request', { ...requestKind(raw), problem: requestProblem(raw) });
            return;
        }
        this.#route(request);
    }

    #route(request: HostRequest): void {
        const existing = this.#connections.get(request.hostId);
        switch (request.type) {
            case 'connect':
                this.#connect(request.hostId, this.#connectionFor(request.hostId, request.target), {
                    restore: request.restore === true,
                });
                break;
            case 'send':
                this.#deliver(request.hostId, 'request', (connection) => connection.send(request.message));
                break;
            case 'input':
                this.#deliver(request.hostId, 'input', (connection) => connection.input(request.stream, request.data));
                break;
            case 'credit':
                this.#deliver(request.hostId, 'credit', (connection) =>
                    connection.credit(request.stream, request.bytes),
                );
                break;
            case 'accept-host-key':
                this.#accept(existing, request.hostId, request.fingerprint);
                break;
            case 'reject-host-key':
                existing?.rejectHostKey();
                break;
            case 'disconnect':
                this.#reconnectors.get(request.hostId)?.disable();
                existing?.close();
                break;
            case 'retry':
                if (existing !== undefined) {
                    this.#connect(request.hostId, existing);
                }
                break;
            case 'stop-retrying':
                this.#stopRetrying(request.hostId, existing);
                break;
            case 'remove-daemon':
                this.#removeDaemon(
                    request.hostId,
                    this.#connectionFor(request.hostId, request.target),
                    request.graceMs,
                );
                break;
        }
    }

    /**
     * Stops the host reconnecting first, as the daemon's core exits once its sessions are stopped, then removes the
     * daemon and reports how that went; the host stays disconnected.
     */
    #removeDaemon(hostId: string, connection: HostConnectionLike, graceMs: number | undefined): void {
        this.#reconnectors.get(hostId)?.disable();
        void connection
            .removeDaemon(graceMs)
            .catch((error: unknown): DaemonRemoval => ({
                kind: 'failed',
                failure: { kind: 'other', details: error instanceof Error ? error.message : String(error) },
            }))
            .then((removal) => this.#post({ type: 'daemon-removed', hostId, removal }));
    }

    /** Connects, or retries at once when the host is waiting to reconnect; from now on it reconnects by itself. */
    #connect(hostId: string, connection: HostConnectionLike, options: EnableOptions = {}): void {
        const reconnector = this.#reconnectors.get(hostId);
        reconnector?.enable(options);
        if (reconnector?.waiting === true) {
            reconnector.retryNow();
        } else {
            void connection.connect();
        }
    }

    #stopRetrying(hostId: string, connection: HostConnectionLike | undefined): void {
        const reconnector = this.#reconnectors.get(hostId);
        if (connection === undefined || reconnector?.waiting !== true) {
            return;
        }
        reconnector.disable();
        this.#post({ type: 'state', hostId, state: connection.state });
    }

    #accept(connection: HostConnectionLike | undefined, hostId: string, fingerprint: string): void {
        connection?.acceptHostKey(fingerprint).catch((error: unknown) => {
            this.#log.error('host key not recorded', { hostId, error: String(error) });
        });
    }

    #deliver(
        hostId: string,
        what: 'request' | 'input' | 'credit',
        action: (connection: HostConnectionLike) => boolean,
    ): void {
        const connection = this.#connections.get(hostId);
        if (connection === undefined || !action(connection)) {
            this.#post({ type: 'refused', hostId, reason: 'not-connected', what });
        }
    }

    #connectionFor(hostId: string, target: ConnectTarget): HostConnectionLike {
        const existing = this.#connections.get(hostId);
        if (existing !== undefined) {
            return existing;
        }
        const report = (state: ConnectionState): void => this.#post({ type: 'state', hostId, state });
        const reconnector = new Reconnector(() => void this.#connections.get(hostId)?.connect(), report);
        const connection = this.#create(hostId, target, {
            state: (state) => {
                this.#batcher.flushAll();
                if (!reconnector.retries(state)) {
                    report(state);
                }
                reconnector.onState(state);
                if (state.status === 'closed') {
                    reconnector.disable();
                    this.#connections.delete(hostId);
                    this.#reconnectors.delete(hostId);
                }
            },
            message: (message) => {
                this.#batcher.flushAll();
                this.#post({ type: 'message', hostId, message });
            },
            output: (stream, data) => this.#batcher.add(hostId, stream, data),
        });
        this.#connections.set(hostId, connection);
        this.#reconnectors.set(hostId, reconnector);
        return connection;
    }
}

const CLIENT_MESSAGE_KINDS = {
    hello: true,
    ping: true,
    listSessions: true,
    listProfiles: true,
    create: true,
    rename: true,
    reorder: true,
    stop: true,
    restart: true,
    close: true,
    attach: true,
    refresh: true,
    detach: true,
    setSessionOptions: true,
    clearScrollback: true,
    restartDaemon: true,
    removeDaemon: true,
    resize: true,
} as const satisfies Record<ClientMessage['type'], true>;
const CLIENT_MESSAGE_TYPES: ReadonlySet<string> = new Set(Object.keys(CLIENT_MESSAGE_KINDS));

const REQUEST_TYPES: ReadonlySet<string> = new Set<HostRequest['type']>([
    'connect',
    'send',
    'input',
    'credit',
    'accept-host-key',
    'reject-host-key',
    'disconnect',
    'retry',
    'stop-retrying',
    'remove-daemon',
]);

/**
 * What kind of request a malformed one claimed to be, and for `send` which message, named only from the known kinds,
 * so a log line never holds what the renderer sent.
 */
function requestKind(raw: unknown): { readonly request: string; readonly message: string | undefined } {
    const type = typeOf(raw);
    const request = type !== undefined && REQUEST_TYPES.has(type) ? type : 'other';
    if (request !== 'send') {
        return { request, message: undefined };
    }
    const message = typeOf((raw as { readonly message?: unknown }).message);
    return { request, message: message !== undefined && CLIENT_MESSAGE_TYPES.has(message) ? message : 'other' };
}

function typeOf(value: unknown): string | undefined {
    if (typeof value !== 'object' || value === null || !('type' in value)) {
        return undefined;
    }
    return typeof value.type === 'string' ? value.type : undefined;
}
