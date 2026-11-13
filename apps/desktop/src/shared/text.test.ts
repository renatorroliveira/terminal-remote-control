import { describe, expect, it } from 'vitest';
import { hasBidiControls, stripBidiControls, stripControlCharacters } from './text';

describe('stripControlCharacters (SEC-06.4)', () => {
    it('removes C0, DEL and C1 control characters', () => {
        expect(stripControlCharacters('a\u0000b\u001bc\u007fd\u0085e\u009bf\tg\nh')).toBe('abcdefgh');
    });

    it('keeps line breaks when asked', () => {
        expect(stripControlCharacters('one\u0007\ntwo', { keepLineBreaks: true })).toBe('one\ntwo');
    });
});

describe('stripBidiControls and hasBidiControls (SEC-06.4)', () => {
    it('removes and detects the characters that make text read in another order than it is stored', () => {
        const hidden = 'https://good.example\u202elave/moc\u2066.x\u2069\u200f\u061c';
        expect(stripBidiControls(hidden)).toBe('https://good.examplelave/moc.x');
        expect(hasBidiControls(hidden)).toBe(true);
        expect(hasBidiControls('https://example.com/日本')).toBe(false);
        expect(hasBidiControls(hidden)).toBe(true);
    });
});
