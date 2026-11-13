import { encodeFrame, FrameKind, MAX_PAYLOAD } from '@trc/protocol';

/**
 * Writes input on a session stream as frames no larger than the protocol allows, stopping at the first frame `write`
 * cannot take: false then, so the caller says the input was not sent instead of losing it silently (US-1.14.2).
 */
export function writeInputFrames(stream: number, data: Uint8Array, write: (frame: Uint8Array) => boolean): boolean {
    for (let offset = 0; offset < data.length; offset += MAX_PAYLOAD) {
        if (!write(encodeFrame(FrameKind.Input, stream, data.subarray(offset, offset + MAX_PAYLOAD)))) {
            return false;
        }
    }
    return true;
}
