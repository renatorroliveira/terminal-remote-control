/** How long output for one stream is collected before it is posted, like VS Code's `TerminalDataBufferer`. */
const BATCH_MS = 5;

/** Posts collected output. */
export type FlushOutput = (hostId: string, stream: number, data: Uint8Array) => void;

/** Joins terminal output per host stream for about 5 ms, so the renderer gets few, larger messages. */
export class OutputBatcher {
    readonly #flush: FlushOutput;
    readonly #pending = new Map<string, { readonly hostId: string; readonly stream: number; chunks: Uint8Array[] }>();
    #timer: ReturnType<typeof setTimeout> | undefined;

    /** Creates a batcher that posts with `flush`. */
    constructor(flush: FlushOutput) {
        this.#flush = flush;
    }

    /** Adds output for a stream. */
    add(hostId: string, stream: number, data: Uint8Array): void {
        const key = `${hostId}\u0000${stream}`;
        const entry = this.#pending.get(key) ?? { hostId, stream, chunks: [] };
        entry.chunks.push(data);
        this.#pending.set(key, entry);
        this.#timer ??= setTimeout(() => this.flushAll(), BATCH_MS);
    }

    /** Posts everything collected now; called before any control message so ordering holds. */
    flushAll(): void {
        clearTimeout(this.#timer);
        this.#timer = undefined;
        for (const { hostId, stream, chunks } of this.#pending.values()) {
            this.#flush(hostId, stream, Buffer.concat(chunks));
        }
        this.#pending.clear();
    }
}
