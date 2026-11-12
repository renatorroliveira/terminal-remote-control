import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '../src/index';

describe('protocol version', () => {
    it('speaks the same protocol version as trc-protocol', () => {
        expect(PROTOCOL_VERSION).toBe(1);
    });
});
