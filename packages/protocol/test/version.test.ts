import { describe, expect, it } from 'vitest';
import { MIN_PROTOCOL_VERSION, negotiate, PROTOCOL_VERSION } from '../src/version';

describe('protocol version', () => {
    it('speaks versions N and N-1, like trc-protocol', () => {
        expect([MIN_PROTOCOL_VERSION, PROTOCOL_VERSION]).toEqual([1, 1]);
    });

    it('negotiates the highest common version', () => {
        expect(negotiate([1, 2], [1, 3])).toBe(2);
        expect(negotiate([2, 3], [1, 2])).toBe(2);
        expect(negotiate([1, 1], [2, 3])).toBeUndefined();
    });
});
