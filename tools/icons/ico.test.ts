import { describe, expect, it } from 'vitest';
import { packIco } from './ico.ts';

describe('packIco', () => {
    it('writes an ICO directory of PNG entries, 256 px stored as 0', () => {
        const small = { size: 16, png: new Uint8Array([1, 2, 3]) };
        const large = { size: 256, png: new Uint8Array([4, 5, 6, 7]) };
        const ico = new DataView(packIco([small, large]).buffer);
        expect([ico.getUint16(0, true), ico.getUint16(2, true), ico.getUint16(4, true)]).toEqual([0, 1, 2]);
        const entry = (index: number) => 6 + index * 16;
        expect([ico.getUint8(entry(0)), ico.getUint8(entry(0) + 1)]).toEqual([16, 16]);
        expect([ico.getUint8(entry(1)), ico.getUint8(entry(1) + 1)]).toEqual([0, 0]);
        expect(ico.getUint16(entry(0) + 6, true)).toBe(32);
        expect(ico.getUint32(entry(0) + 8, true)).toBe(3);
        expect(ico.getUint32(entry(0) + 12, true)).toBe(6 + 2 * 16);
        expect(ico.getUint32(entry(1) + 12, true)).toBe(6 + 2 * 16 + 3);
        expect(ico.byteLength).toBe(6 + 2 * 16 + 3 + 4);
        expect(ico.getUint8(6 + 2 * 16 + 3)).toBe(4);
    });
});
