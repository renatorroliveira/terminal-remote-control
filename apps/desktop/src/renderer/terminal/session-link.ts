import type { CreateSessionSpec, ResyncKind, ServerMessage, SessionId, SessionInfo, TerminalSize } from '@trc/protocol';
import type { HostClient } from '../connection/host-client';

/** The part of the host client a session link uses. */
export type SessionTransport = Pick<
    HostClient,
    'request' | 'input' | 'credit' | 'onOutput' | 'onInputRefused' | 'onMessage'
>;

/** How an attach replays the session: what the output that follows is, and whether `synced` ends it. */
export interface ReplayStart {
    /** A `delta` adds the output missed to the terminal as it is; a `snapshot` replaces it. */
    readonly kind: 'delta' | 'snapshot';
    /** Protocol 2 ends a replay with `synced`; protocol 1 says nothing, so its screen ends when output settles. */
    readonly endsWithSynced: boolean;
}

/** What a session link reports beyond output. */
export interface LinkEvents {
    /** An attach answered, before any of the replay's output arrives (US-2.2.2). */
    readonly replay?: (replay: ReplayStart) => void;
    /** A replay or a resync ended: what follows is live output (protocol 2). */
    readonly synced?: () => void;
    /** The daemon starts over after the client fell behind: the terminal is replaced by what follows (D-04). */
    readonly resync?: (kind: ResyncKind) => void;
    /** Another client typed into the session (US-2.6.4). */
    readonly peerInput?: () => void;
    /** Another client opened a session that serves one client at a time, which ended this attachment (P-27). */
    readonly detached?: () => void;
}

/** How a link attaches again after a reconnect. */
export interface ReattachOptions {
    /**
     * Sends the terminal's size too, as the open terminal does; the others take theirs back on focus or input, so a
     * reconnect never overrides a size another client set meanwhile (P-31).
     */
    readonly sendSize: boolean;
}

interface Attachment {
    readonly session: SessionId;
    readonly stream: number;
    readonly stopOutput: () => void;
    readonly stopMessages: () => void;
}

/** A gap is filled once output has paused this long, so a flood is not interrupted by refreshes (D-45). */
const GAP_QUIET_MS = 1_000;
/** How long a gap may take to fill before review mode or find opens without it. */
const FILL_TIMEOUT_MS = 5_000;

/**
 * Joins one daemon session to a terminal view: output in, and input, credit and size changes out. Input before
 * the session is attached has nowhere to go and is refused, so the view can say it was not sent (US-1.14.2).
 *
 * With protocol 2 it also keeps the offset of the next output byte from the daemon's `synced`, so a reattach gets only
 * the output missed (US-2.2.2), and after a resync that skipped rows it asks for the whole buffer again once output
 * pauses (D-45).
 */
export class SessionLink {
    readonly #transport: SessionTransport;
    readonly #hostId: string;
    readonly #onOutput: (data: Uint8Array) => void;
    readonly #events: LinkEvents;
    #size: TerminalSize | undefined;
    #session: SessionId | undefined;
    #attachment: Attachment | undefined;
    #disposed = false;
    /** Whether this client sets the session's size; not while another client set it (P-31). */
    #holdsSize = true;
    /** The offset of the next live byte, once the daemon has said; undefined during a replay. */
    #offset: number | undefined;
    /** Rows were skipped: a screen resync left the scrollback incomplete. */
    #gap = false;
    #quiet: ReturnType<typeof setTimeout> | undefined;
    #filled: (() => void)[] = [];
    #displaced = false;

    /** Creates a link for a host; `onOutput` receives the attached session's output. */
    constructor(
        transport: SessionTransport,
        hostId: string,
        onOutput: (data: Uint8Array) => void,
        events: LinkEvents = {},
    ) {
        this.#transport = transport;
        this.#hostId = hostId;
        this.#onOutput = onOutput;
        this.#events = events;
    }

    /** Whether a session is attached. */
    get attached(): boolean {
        return this.#attachment !== undefined;
    }

    /** Whether another client took the session, until this link attaches again (P-27). */
    get displaced(): boolean {
        return this.#displaced;
    }

    /** Whether the terminal lacks rows a resync skipped, until the next whole buffer arrives (D-45). */
    get hasGap(): boolean {
        return this.#gap;
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

    /**
     * Attaches to a session's full output, then sends it the terminal's size. An attach that answers after the link
     * was disposed detaches at once and routes nothing.
     */
    async attach(session: SessionId): Promise<void> {
        await this.#attach(session, undefined, true);
    }

    /**
     * Attaches again to the last session asked for, over a connection that replaced a lost one, from the offset of the
     * output received when the daemon said where it stood; the old stream's output stops at once (US-1.14.3,
     * US-2.2.2). It sends the terminal's size only when asked.
     */
    async reattach({ sendSize }: ReattachOptions = { sendSize: false }): Promise<void> {
        const from = this.#offset;
        this.#stopAttachment();
        if (this.#session !== undefined) {
            await this.#attach(this.#session, from, sendSize);
        }
    }

    /** Sends typed text or key bytes to the session; false when no session is attached to send them to. */
    input(text: string): boolean {
        if (this.#attachment === undefined) {
            return false;
        }
        this.#transport.input(this.#hostId, this.#attachment.stream, text);
        return true;
    }

    /** Returns output credit once the terminal has parsed `bytes` (D-19). */
    credit(bytes: number): void {
        if (this.#attachment !== undefined) {
            this.#transport.credit(this.#hostId, this.#attachment.stream, bytes);
        }
    }

    /** Records the terminal's size and sends it to the attached session (US-1.11.3). */
    resize({ cols, rows }: TerminalSize): void {
        this.#size = { cols, rows };
        this.#holdsSize = true;
        this.#sendSize();
    }

    /** Another client set the session's size: attaching again no longer sends this client's size (P-31). */
    releaseSize(): void {
        this.#holdsSize = false;
    }

    /**
     * Asks for the whole buffer now when rows are missing, and resolves once it has arrived, or after 5 s, so review
     * mode and find see every line (A11Y-02.3, A11Y-03). Resolves at once when nothing is missing.
     */
    fillGap(): Promise<void> {
        if (!this.#gap || this.#attachment === undefined) {
            return Promise.resolve();
        }
        const filled = new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, FILL_TIMEOUT_MS);
            this.#filled.push(() => {
                clearTimeout(timer);
                resolve();
            });
        });
        this.#refresh();
        return filled;
    }

    /**
     * The host's connection is gone, and the attachment with it: no output, input or credit goes to its stream, whose
     * number a new connection reuses. {@link SessionLink.reattach} attaches again from where output stood.
     */
    connectionLost(): void {
        this.#stopAttachment();
    }

    /** Stops routing output and detaches from the session. */
    dispose(): void {
        this.#disposed = true;
        const attachment = this.#attachment;
        this.#stopAttachment();
        if (attachment !== undefined) {
            this.#detach(attachment.session);
        }
    }

    async #attach(session: SessionId, fromOffset: number | undefined, sendSize: boolean): Promise<void> {
        this.#session = session;
        const request = { type: 'attach', session, mode: 'full' } as const;
        const reply = await this.#transport.request(
            this.#hostId,
            fromOffset === undefined ? request : { ...request, fromOffset },
        );
        if (reply.type !== 'attached') {
            throw new Error(`unexpected reply ${reply.type}`);
        }
        if (this.#disposed) {
            this.#detach(session);
            return;
        }
        this.#offset = undefined;
        this.#gap = false;
        this.#displaced = false;
        this.#events.replay?.({
            kind: reply.replay === 'delta' ? 'delta' : 'snapshot',
            endsWithSynced: reply.replay !== undefined,
        });
        const { stream } = reply;
        const stopOutput = this.#transport.onOutput(this.#hostId, stream, (data) => this.#output(data));
        const stopMessages = this.#transport.onMessage(this.#hostId, (message) => this.#message(stream, message));
        this.#attachment = { session, stream, stopOutput, stopMessages };
        if (sendSize) {
            this.#sendSize();
        }
    }

    #output(data: Uint8Array): void {
        if (this.#offset !== undefined) {
            this.#offset += data.length;
        }
        if (this.#gap) {
            this.#awaitQuiet();
        }
        this.#onOutput(data);
    }

    #message(stream: number, message: ServerMessage): void {
        if (!('stream' in message) || message.stream !== stream || message.type === 'attached') {
            return;
        }
        switch (message.type) {
            case 'synced':
                this.#synced(message.offset);
                break;
            case 'resync':
                this.#offset = undefined;
                this.#gap = message.kind === 'screen';
                this.#events.resync?.(message.kind);
                break;
            case 'peerInput':
                this.#events.peerInput?.();
                break;
            case 'detached':
                this.#stopAttachment();
                this.#displaced = true;
                this.#events.detached?.();
                break;
        }
    }

    #synced(offset: number): void {
        this.#offset = offset;
        this.#events.synced?.();
        if (this.#gap) {
            this.#awaitQuiet();
            return;
        }
        for (const filled of this.#filled.splice(0)) {
            filled();
        }
    }

    #awaitQuiet(): void {
        clearTimeout(this.#quiet);
        this.#quiet = setTimeout(() => this.#refresh(), GAP_QUIET_MS);
    }

    #refresh(): void {
        clearTimeout(this.#quiet);
        this.#quiet = undefined;
        const session = this.#attachment?.session;
        if (session !== undefined) {
            this.#transport.request(this.#hostId, { type: 'refresh', session }).catch(ignore);
        }
    }

    #stopAttachment(): void {
        clearTimeout(this.#quiet);
        this.#quiet = undefined;
        this.#attachment?.stopOutput();
        this.#attachment?.stopMessages();
        this.#attachment = undefined;
    }

    #detach(session: SessionId): void {
        this.#transport.request(this.#hostId, { type: 'detach', session }).catch(ignore);
    }

    #sendSize(): void {
        if (this.#attachment === undefined || this.#size === undefined || !this.#holdsSize) {
            return;
        }
        const request = { type: 'resize', session: this.#attachment.session, size: this.#size } as const;
        this.#transport.request(this.#hostId, request).catch(ignore);
    }
}

function ignore(): void {
    return;
}
