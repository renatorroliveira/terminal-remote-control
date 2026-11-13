/** How long output that follows a post is collected before the next post, like VS Code's `TerminalDataBufferer`. */
const BATCH_MS = 5;

/** Posts collected output. */
export type FlushOutput = (hostId: string, stream: number, data: Uint8Array) => void;

interface Pending {
    readonly hostId: string;
    readonly stream: number;
    readonly chunks: Uint8Array[];
}

/**
 * Throttles terminal output posts with a leading edge. Output that arrives while idle is posted at once, so a
 * keystroke echo never waits (NFR-02). Output that follows within 5 ms is joined per host stream and posted when
 * the window ends, so a flood becomes few, larger messages (NFR-03).
 */
export class OutputBatcher {
    readonly #flush: FlushOutput;
    readonly #pending = new Map<string, Pending>();
    #window: ReturnType<typeof setTimeout> | undefined;

    /** Creates a batcher that posts with `flush`. */
    constructor(flush: FlushOutput) {
        this.#flush = flush;
    }

    /** Adds output for a stream: posted now when idle, otherwise at the end of the current window. */
    add(hostId: string, stream: number, data: Uint8Array): void {
        if (this.#window === undefined) {
            this.#flush(hostId, stream, data);
            this.#openWindow();
            return;
        }
        const key = `${hostId}\u0000${stream}`;
        const entry = this.#pending.get(key) ?? { hostId, stream, chunks: [] };
        entry.chunks.push(data);
        this.#pending.set(key, entry);
    }

    /** Posts everything collected now; called before any control message so ordering holds. */
    flushAll(): void {
        for (const { hostId, stream, chunks } of this.#pending.values()) {
            this.#flush(hostId, stream, chunks.length === 1 ? (chunks[0] ?? new Uint8Array()) : Buffer.concat(chunks));
        }
        this.#pending.clear();
    }

    #openWindow(): void {
        this.#window = setTimeout(() => this.#closeWindow(), BATCH_MS);
    }

    #closeWindow(): void {
        this.#window = undefined;
        if (this.#pending.size > 0) {
            this.flushAll();
            this.#openWindow();
        }
    }
}
