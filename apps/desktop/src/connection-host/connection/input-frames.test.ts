import { FrameKind, MAX_PAYLOAD } from '@trc/protocol';
import { describe, expect, it } from 'vitest';
import { writeInputFrames } from './input-frames';

describe('writeInputFrames (US-1.14.2, NFR-03)', () => {
    it('writes input as frames of at most the largest payload, and reports it sent', () => {
        const frames: Uint8Array[] = [];
        const sent = writeInputFrames(7, new Uint8Array(MAX_PAYLOAD + 10), (frame) => frames.push(frame) > 0);
        expect(sent).toBe(true);
        expect(frames).toHaveLength(2);
        expect(frames[0]?.[4]).toBe(FrameKind.Input);
    });

    it('stops at the first frame it cannot write, and reports the input not sent', () => {
        let writes = 0;
        const sent = writeInputFrames(7, new Uint8Array(MAX_PAYLOAD * 3), () => {
            writes += 1;
            return writes < 2;
        });
        expect(sent).toBe(false);
        expect(writes).toBe(2);
    });
});
