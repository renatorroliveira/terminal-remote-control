/** Frame kinds on the wire (TECH_STACK §6). Unknown kinds are passed through as their number. */
export const FrameKind = {
    Control: 0,
    Output: 1,
    Input: 2,
    Credit: 3,
} as const;

/** A frame kind value. */
export type FrameKindValue = number;

/** Bytes in the frame header: length, kind and stream. */
export const HEADER_LEN = 9;
/** The largest payload a frame may carry. */
export const MAX_PAYLOAD = 1024 * 1024;
/** The largest payload an `OUTPUT` frame carries. */
export const MAX_OUTPUT_CHUNK = 32 * 1024;
/** The stream that carries control messages. */
export const CONTROL_STREAM = 0;

/** One decoded frame. */
export interface Frame {
    readonly kind: FrameKindValue;
    readonly stream: number;
    readonly payload: Uint8Array;
}

/** A frame that cannot be encoded or decoded. */
export class FrameError extends Error {
    override readonly name = 'FrameError';
}

/** Encodes one frame: `u32 length | u8 kind | u32 stream | payload`, big-endian. */
export function encodeFrame(kind: FrameKindValue, stream: number, payload: Uint8Array): Uint8Array {
    if (payload.byteLength > MAX_PAYLOAD) {
        throw new FrameError(`frame payload of ${payload.byteLength} bytes exceeds the ${MAX_PAYLOAD}-byte limit`);
    }
    const bytes = new Uint8Array(HEADER_LEN + payload.byteLength);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, payload.byteLength + HEADER_LEN - 4);
    view.setUint8(4, kind);
    view.setUint32(5, stream);
    bytes.set(payload, HEADER_LEN);
    return bytes;
}

/** Encodes a `CREDIT` frame granting `granted` bytes on `stream`. */
export function encodeCredit(stream: number, granted: number): Uint8Array {
    const payload = new Uint8Array(4);
    new DataView(payload.buffer).setUint32(0, granted);
    return encodeFrame(FrameKind.Credit, stream, payload);
}

/** Incremental decoder: push bytes as they arrive and receive every whole frame they complete. */
export class FrameDecoder {
    #buffer = new Uint8Array(64 * 1024);
    #length = 0;

    /** Appends received bytes and returns the frames they complete. Throws {@link FrameError} on a malformed frame. */
    push(chunk: Uint8Array): readonly Frame[] {
        this.#append(chunk);
        const frames: Frame[] = [];
        let frame = this.#take();
        while (frame !== undefined) {
            frames.push(frame);
            frame = this.#take();
        }
        return frames;
    }

    #append(chunk: Uint8Array): void {
        if (this.#length + chunk.byteLength > this.#buffer.byteLength) {
            const grown = new Uint8Array(Math.max(this.#buffer.byteLength * 2, this.#length + chunk.byteLength));
            grown.set(this.#buffer.subarray(0, this.#length));
            this.#buffer = grown;
        }
        this.#buffer.set(chunk, this.#length);
        this.#length += chunk.byteLength;
    }

    #take(): Frame | undefined {
        if (this.#length < 4) {
            return undefined;
        }
        const view = new DataView(this.#buffer.buffer, this.#buffer.byteOffset, this.#length);
        const body = view.getUint32(0);
        if (body < HEADER_LEN - 4) {
            throw new FrameError(`frame length ${body} is shorter than its header`);
        }
        if (body - (HEADER_LEN - 4) > MAX_PAYLOAD) {
            throw new FrameError(
                `frame payload of ${body - (HEADER_LEN - 4)} bytes exceeds the ${MAX_PAYLOAD}-byte limit`,
            );
        }
        if (this.#length < 4 + body) {
            return undefined;
        }
        const frame: Frame = {
            kind: view.getUint8(4),
            stream: view.getUint32(5),
            payload: this.#buffer.slice(HEADER_LEN, 4 + body),
        };
        this.#buffer.copyWithin(0, 4 + body, this.#length);
        this.#length -= 4 + body;
        return frame;
    }
}
