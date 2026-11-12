import type { Readable } from 'node:stream';

const NEWLINE = 0x0a;

/**
 * Reads newline-terminated lines from a stream without consuming more than it was given, so the stream can be
 * handed to another reader afterwards together with {@link LineReader.release}'s leftover bytes.
 */
export class LineReader {
    readonly #stream: Readable;
    #buffer: Buffer = Buffer.alloc(0);
    #ended = false;
    #released = false;
    #wake: (() => void) | undefined;

    /** Starts reading `stream`. */
    constructor(stream: Readable) {
        this.#stream = stream;
        stream.on('data', this.#onData);
        stream.on('end', this.#onEnd);
        stream.on('close', this.#onEnd);
    }

    /** The next line without its newline, or `undefined` once the stream has ended. */
    async next(): Promise<string | undefined> {
        for (;;) {
            const newline = this.#buffer.indexOf(NEWLINE);
            if (newline >= 0) {
                const line = this.#buffer.subarray(0, newline).toString('utf8');
                this.#buffer = this.#buffer.subarray(newline + 1);
                return line.endsWith('\r') ? line.slice(0, -1) : line;
            }
            if (this.#ended) {
                return undefined;
            }
            await new Promise<void>((resolve) => {
                this.#wake = resolve;
            });
        }
    }

    /** Stops reading, pauses the stream and returns the bytes read but not yet returned as lines. */
    release(): Uint8Array {
        if (!this.#released) {
            this.#released = true;
            this.#stream.off('data', this.#onData);
            this.#stream.off('end', this.#onEnd);
            this.#stream.off('close', this.#onEnd);
            this.#stream.pause();
        }
        return new Uint8Array(this.#buffer);
    }

    readonly #onData = (chunk: Buffer | string): void => {
        const bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
        this.#buffer = Buffer.concat([this.#buffer, bytes]);
        this.#notify();
    };

    readonly #onEnd = (): void => {
        this.#ended = true;
        this.#notify();
    };

    #notify(): void {
        const wake = this.#wake;
        this.#wake = undefined;
        wake?.();
    }
}
