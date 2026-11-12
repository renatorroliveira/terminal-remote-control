import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodeCredit, encodeFrame, FrameDecoder, FrameError, FrameKind, MAX_PAYLOAD } from '../src/frame';

const bytes = (...values: readonly number[]): Uint8Array => Uint8Array.from(values);
const text = (value: string): Uint8Array => new TextEncoder().encode(value);

describe('encodeFrame', () => {
    it('writes a big-endian header', () => {
        expect(encodeFrame(FrameKind.Output, 7, text('hi'))).toEqual(bytes(0, 0, 0, 7, 1, 0, 0, 0, 7, 104, 105));
    });

    it('refuses payloads over the limit', () => {
        expect(() => encodeFrame(FrameKind.Control, 0, new Uint8Array(MAX_PAYLOAD + 1))).toThrow(FrameError);
    });
});

describe('encodeCredit', () => {
    it('carries the granted bytes as a u32', () => {
        expect(encodeCredit(3, 65_536)).toEqual(bytes(0, 0, 0, 9, 3, 0, 0, 0, 3, 0, 1, 0, 0));
    });
});

describe('FrameDecoder', () => {
    it('decodes frames split across chunks, routing on the header alone', () => {
        const wire = new Uint8Array([
            ...encodeFrame(FrameKind.Control, 0, text('{}')),
            ...encodeFrame(FrameKind.Input, 2, bytes(3)),
        ]);
        const decoder = new FrameDecoder();
        const frames = [...wire].flatMap((byte) => decoder.push(bytes(byte)));

        expect(frames).toEqual([
            { kind: FrameKind.Control, stream: 0, payload: text('{}') },
            { kind: FrameKind.Input, stream: 2, payload: bytes(3) },
        ]);
    });

    it('rejects lengths shorter than the header and frames over the limit', () => {
        expect(() => new FrameDecoder().push(bytes(0, 0, 0, 4, 0, 0, 0, 0))).toThrow(FrameError);
        const tooLarge = new DataView(new ArrayBuffer(4));
        tooLarge.setUint32(0, MAX_PAYLOAD + 6);
        expect(() => new FrameDecoder().push(new Uint8Array(tooLarge.buffer))).toThrow(FrameError);
    });

    it('decodes the shared frame fixture the Rust encoder wrote', () => {
        const wire = readFileSync(resolve(import.meta.dirname, '../../../protocol/fixtures/v1/frames.bin'));
        const frames = new FrameDecoder().push(new Uint8Array(wire));

        expect(frames.map(({ kind, stream }) => [kind, stream])).toEqual([
            [FrameKind.Control, 0],
            [FrameKind.Output, 1],
            [FrameKind.Input, 1],
            [FrameKind.Credit, 1],
        ]);
        expect(JSON.parse(new TextDecoder().decode(frames[0]?.payload))).toEqual({ type: 'ping', requestId: 1 });
        expect(frames[1]?.payload).toEqual(text('hello\r\n'));
        expect(frames[3]?.payload).toEqual(bytes(0, 1, 0, 0));
    });
});
