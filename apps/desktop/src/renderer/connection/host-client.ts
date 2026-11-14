import type { ClientMessage, ErrorCode, ServerMessage } from '@trc/protocol';
import {
    type ConnectionState,
    type ConnectTarget,
    type HostEvent,
    type HostRequest,
    RESERVED_REQUEST_IDS,
} from '../../shared/connection';

type RequestMessage = Exclude<ClientMessage, { readonly type: 'hello' } | { readonly type: 'ping' }>;

/** A daemon request without its request ID, which the client assigns. */
export type ClientRequest = RequestMessage extends infer M
    ? M extends RequestMessage
        ? Omit<M, 'requestId'>
        : never
    : never;

/** Why a request failed: the daemon's error code, or `disconnected` when the host dropped first. */
export class HostRequestError extends Error {
    /** The daemon's error code, or `disconnected`. */
    readonly code: ErrorCode | 'disconnected';

    /** Creates the error. */
    constructor(code: ErrorCode | 'disconnected', message: string) {
        super(message);
        this.name = 'HostRequestError';
        this.code = code;
    }
}

interface Pending {
    readonly hostId: string;
    readonly resolve: (message: ServerMessage) => void;
    readonly reject: (error: HostRequestError) => void;
}

type Listener<T> = (value: T) => void;

const CONNECTION_ENDED: ReadonlySet<ConnectionState['status']> = new Set(['failed', 'disconnected', 'closed']);

/**
 * The renderer's side of the MessagePort to the connection host: connects hosts, correlates daemon requests with
 * their replies, and routes host states, daemon messages and terminal output to their listeners.
 */
export class HostClient {
    readonly #port: MessagePort;
    readonly #pending = new Map<number, Pending>();
    readonly #states = new Map<string, Set<Listener<ConnectionState>>>();
    readonly #messages = new Map<string, Set<Listener<ServerMessage>>>();
    readonly #outputs = new Map<string, Set<Listener<Uint8Array>>>();
    readonly #inputRefused = new Set<Listener<string>>();
    readonly #encoder = new TextEncoder();
    #nextRequestId = 1;

    /** Starts listening on the port. */
    constructor(port: MessagePort) {
        this.#port = port;
        port.onmessage = (event: MessageEvent<HostEvent>) => this.#receive(event.data);
    }

    /** Connects a host, or retries a failed connection. */
    connect(hostId: string, target: ConnectTarget): void {
        this.#post({ type: 'connect', hostId, target });
    }

    /** Closes a host's connection. */
    disconnect(hostId: string): void {
        this.#post({ type: 'disconnect', hostId });
    }

    /** Trusts the host key the user confirmed (US-1.2). */
    acceptHostKey(hostId: string, fingerprint: string): void {
        this.#post({ type: 'accept-host-key', hostId, fingerprint });
    }

    /** Refuses the presented host key. */
    rejectHostKey(hostId: string): void {
        this.#post({ type: 'reject-host-key', hostId });
    }

    /** Sends a daemon request; resolves with its reply, or rejects with a {@link HostRequestError}. */
    request(hostId: string, request: ClientRequest): Promise<ServerMessage> {
        const requestId = this.#takeRequestId();
        const message = { ...request, requestId } as ClientMessage;
        return new Promise((resolve, reject) => {
            this.#pending.set(requestId, { hostId, resolve, reject });
            this.#post({ type: 'send', hostId, message });
        });
    }

    /** Sends typed text or key bytes to a session's stream. */
    input(hostId: string, stream: number, text: string): void {
        this.#post({ type: 'input', hostId, stream, data: this.#encoder.encode(text) });
    }

    /** Returns output credit for a stream (D-19). */
    credit(hostId: string, stream: number, bytes: number): void {
        this.#post({ type: 'credit', hostId, stream, bytes });
    }

    /** Calls `listener` with each state of a host; returns a function that stops listening. */
    onState(hostId: string, listener: Listener<ConnectionState>): () => void {
        return subscribe(this.#states, hostId, listener);
    }

    /** Calls `listener` with each daemon message that answers no request; returns a function that stops listening. */
    onMessage(hostId: string, listener: Listener<ServerMessage>): () => void {
        return subscribe(this.#messages, hostId, listener);
    }

    /** Calls `listener` with each output chunk of a stream; returns a function that stops listening. */
    onOutput(hostId: string, stream: number, listener: Listener<Uint8Array>): () => void {
        return subscribe(this.#outputs, outputKey(hostId, stream), listener);
    }

    /** Listens for input the connection host could not send, with the host it was for (US-1.14.2). */
    onInputRefused(listener: Listener<string>): () => void {
        this.#inputRefused.add(listener);
        return () => this.#inputRefused.delete(listener);
    }

    #post(request: HostRequest): void {
        this.#port.postMessage(request);
    }

    #takeRequestId(): number {
        const requestId = this.#nextRequestId;
        this.#nextRequestId = requestId + 1 >= RESERVED_REQUEST_IDS ? 1 : requestId + 1;
        return requestId;
    }

    #receive(event: HostEvent): void {
        switch (event.type) {
            case 'state':
                this.#onState(event.hostId, event.state);
                break;
            case 'message':
                this.#onMessage(event.hostId, event.message);
                break;
            case 'output':
                notify(this.#outputs, outputKey(event.hostId, event.stream), event.data);
                break;
            case 'refused':
                this.#onRefused(event);
                break;
        }
    }

    #onState(hostId: string, state: ConnectionState): void {
        if (CONNECTION_ENDED.has(state.status)) {
            this.#rejectHost(hostId, `host ${state.status}`);
        }
        notify(this.#states, hostId, state);
    }

    #onMessage(hostId: string, message: ServerMessage): void {
        const requestId = 'requestId' in message ? message.requestId : undefined;
        const pending = requestId === undefined ? undefined : this.#pending.get(requestId);
        if (requestId === undefined || pending === undefined || pending.hostId !== hostId) {
            notify(this.#messages, hostId, message);
            return;
        }
        this.#pending.delete(requestId);
        if (message.type === 'error') {
            pending.reject(new HostRequestError(message.code, message.message));
        } else {
            pending.resolve(message);
        }
    }

    #onRefused(event: Extract<HostEvent, { type: 'refused' }>): void {
        if (event.what === 'request') {
            this.#rejectHost(event.hostId, `request refused: ${event.reason}`);
        } else if (event.what === 'input') {
            for (const listener of this.#inputRefused) {
                listener(event.hostId);
            }
        }
    }

    #rejectHost(hostId: string, reason: string): void {
        for (const [requestId, pending] of this.#pending) {
            if (pending.hostId === hostId) {
                this.#pending.delete(requestId);
                pending.reject(new HostRequestError('disconnected', reason));
            }
        }
    }
}

function subscribe<T>(registry: Map<string, Set<Listener<T>>>, key: string, listener: Listener<T>): () => void {
    const listeners = registry.get(key) ?? new Set<Listener<T>>();
    registry.set(key, listeners);
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
            registry.delete(key);
        }
    };
}

function notify<T>(registry: ReadonlyMap<string, ReadonlySet<Listener<T>>>, key: string, value: T): void {
    for (const listener of registry.get(key) ?? []) {
        listener(value);
    }
}

function outputKey(hostId: string, stream: number): string {
    return `${hostId}\u0000${stream}`;
}
