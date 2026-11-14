import type { ClientMessage, ServerMessage } from '@trc/protocol';
import type { ConnectionState, ConnectTarget, HostEvent, HostRequest } from '../../shared/connection';
import type { AppLogger } from '../logging/app-log';
import { OutputBatcher } from './output-batcher';
import { parseHostRequest } from './requests';

/** What a host connection reports. */
export interface ConnectionListener {
    state(state: ConnectionState): void;
    message(message: ServerMessage): void;
    output(stream: number, data: Uint8Array): void;
}

/** The host connection operations the router uses. Each returns `false` when the connection cannot take it. */
export interface HostConnectionLike {
    connect(): Promise<void>;
    send(message: ClientMessage): boolean;
    input(stream: number, data: Uint8Array): boolean;
    credit(stream: number, bytes: number): boolean;
    acceptHostKey(fingerprint: string): Promise<void>;
    rejectHostKey(): void;
    close(): void;
}

/** Creates the connection for a host. */
export type CreateConnection = (
    hostId: string,
    target: ConnectTarget,
    listener: ConnectionListener,
) => HostConnectionLike;

/**
 * Routes validated renderer requests to one connection per host, and posts connection events back: states and
 * control messages at once, terminal output batched, with output always flushed before a control message.
 */
export class ConnectionRouter {
    readonly #post: (event: HostEvent) => void;
    readonly #create: CreateConnection;
    readonly #log: AppLogger;
    readonly #connections = new Map<string, HostConnectionLike>();
    readonly #batcher: OutputBatcher;

    /** Creates a router posting with `post` and making connections with `create`. */
    constructor(post: (event: HostEvent) => void, create: CreateConnection, log: AppLogger) {
        this.#post = post;
        this.#create = create;
        this.#log = log;
        this.#batcher = new OutputBatcher((hostId, stream, data) => post({ type: 'output', hostId, stream, data }));
    }

    /** Handles one message from the renderer. */
    handle(raw: unknown): void {
        const request = parseHostRequest(raw);
        if (request === undefined) {
            this.#log.warn('invalid request');
            return;
        }
        this.#route(request);
    }

    #route(request: HostRequest): void {
        const existing = this.#connections.get(request.hostId);
        switch (request.type) {
            case 'connect':
                void this.#connectionFor(request.hostId, request.target).connect();
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
                existing?.close();
                break;
        }
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
        const connection = this.#create(hostId, target, {
            state: (state) => {
                this.#batcher.flushAll();
                this.#post({ type: 'state', hostId, state });
                if (state.status === 'closed') {
                    this.#connections.delete(hostId);
                }
            },
            message: (message) => {
                this.#batcher.flushAll();
                this.#post({ type: 'message', hostId, message });
            },
            output: (stream, data) => this.#batcher.add(hostId, stream, data),
        });
        this.#connections.set(hostId, connection);
        return connection;
    }
}
