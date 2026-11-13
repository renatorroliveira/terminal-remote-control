import { describe, expect, it } from 'vitest';
import { stripControlCharacters } from './text';

describe('stripControlCharacters (SEC-06.4)', () => {
    it('removes C0, DEL and C1 control characters', () => {
        expect(stripControlCharacters('a\u0000b\u001bc\u007fd\u0085e\u009bf\tg\nh')).toBe('abcdefgh');
    });

    it('keeps line breaks when asked', () => {
        expect(stripControlCharacters('one\u0007\ntwo', { keepLineBreaks: true })).toBe('one\ntwo');
    });
});
