import type { CreateSessionSpec, SessionId, SessionInfo, TerminalSize } from '@trc/protocol';
import type { HostClient } from '../connection/host-client';

/** The part of the host client a session link uses. */
export type SessionTransport = Pick<HostClient, 'request' | 'input' | 'credit' | 'onOutput'>;

interface Attachment {
    readonly session: SessionId;
    readonly stream: number;
    readonly stopOutput: () => void;
}

/**
 * Joins one daemon session to a terminal view: output in, and input, credit and size changes out. Input before
 * the session is attached has nowhere to go and is dropped.
 */
export class SessionLink {
    readonly #transport: SessionTransport;
    readonly #hostId: string;
    readonly #onOutput: (data: Uint8Array) => void;
    #size: TerminalSize | undefined;
    #attachment: Attachment | undefined;

    /** Creates a link for a host; `onOutput` receives the attached session's output. */
    constructor(transport: SessionTransport, hostId: string, onOutput: (data: Uint8Array) => void) {
        this.#transport = transport;
        this.#hostId = hostId;
        this.#onOutput = onOutput;
    }

    /** Whether a session is attached. */
    get attached(): boolean {
        return this.#attachment !== undefined;
    }

    /** Creates a session at the terminal's current size and attaches to it. */
    async create(spec: Omit<CreateSessionSpec, 'size'>): Promise<SessionInfo> {
        const size = this.#size;
        if (size === undefined) {
            throw new Error('the terminal has no size yet');
        }
        const reply = await this.#transport.request(this.#hostId, { type: 'create', spec: { ...spec, size } });
        if (reply.type !== 'created') {
            throw new Error(`unexpected reply ${reply.type}`);
        }
        await this.attach(reply.session.id);
        return reply.session;
    }

    /** Attaches to a session's full output, then sends it the terminal's size. */
    async attach(session: SessionId): Promise<void> {
        const reply = await this.#transport.request(this.#hostId, { type: 'attach', session, mode: 'full' });
        if (reply.type !== 'attached') {
            throw new Error(`unexpected reply ${reply.type}`);
        }
        const stopOutput = this.#transport.onOutput(this.#hostId, reply.stream, this.#onOutput);
        this.#attachment = { session, stream: reply.stream, stopOutput };
        this.#sendSize();
    }

    /** Sends typed text or key bytes to the session. */
    input(text: string): void {
        if (this.#attachment !== undefined) {
            this.#transport.input(this.#hostId, this.#attachment.stream, text);
        }
    }

    /** Returns output credit once the terminal has parsed `bytes` (D-19). */
    credit(bytes: number): void {
        if (this.#attachment !== undefined) {
            this.#transport.credit(this.#hostId, this.#attachment.stream, bytes);
        }
    }

    /** Records the terminal's size and sends it to the attached session (US-1.11.3). */
    resize(size: TerminalSize): void {
        this.#size = size;
        this.#sendSize();
    }

    /** Stops routing output and detaches from the session. */
    dispose(): void {
        const attachment = this.#attachment;
        this.#attachment = undefined;
        if (attachment === undefined) {
            return;
        }
        attachment.stopOutput();
        this.#transport.request(this.#hostId, { type: 'detach', session: attachment.session }).catch(ignore);
    }

    #sendSize(): void {
        if (this.#attachment === undefined || this.#size === undefined) {
            return;
        }
        const request = { type: 'resize', session: this.#attachment.session, size: this.#size } as const;
        this.#transport.request(this.#hostId, request).catch(ignore);
    }
}

function ignore(): void {
    return;
}
