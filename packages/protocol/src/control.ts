import { encodeFrame, FrameKind } from './frame';
import type { ClientMessage } from './generated/ClientMessage';
import type { ServerMessage } from './generated/ServerMessage';
import { ServerMessageSchema } from './schemas';

/** The outcome of decoding a daemon's control message. */
export type DecodeResult =
    { readonly ok: true; readonly message: ServerMessage } | { readonly ok: false; readonly error: string };

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

/** Encodes a client message as one `CONTROL` frame on stream 0. */
export function encodeClientMessage(message: ClientMessage): Uint8Array {
    return encodeFrame(FrameKind.Control, 0, encoder.encode(JSON.stringify(message)));
}

/** Parses and validates a `CONTROL` payload from a daemon. Never throws. */
export function decodeServerMessage(payload: Uint8Array): DecodeResult {
    let json: unknown;
    try {
        json = JSON.parse(decoder.decode(payload));
    } catch {
        return { ok: false, error: 'control payload is not UTF-8 JSON' };
    }
    const parsed = ServerMessageSchema.safeParse(json);
    return parsed.success
        ? { ok: true, message: parsed.data }
        : {
              ok: false,
              error: `invalid control message: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
          };
}
