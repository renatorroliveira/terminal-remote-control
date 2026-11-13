import { describe, expect, it } from 'vitest';
import { encodePaste, pastedLines } from './paste';

describe('encodePaste: pasted text as the process receives it (US-1.12.2)', () => {
    it('sends line breaks as Return, as typing them would', () => {
        expect(encodePaste('a\r\nb\nc', false)).toBe('a\rb\rc');
    });

    it('wraps the text in bracketed paste, and drops bracket sequences inside it so a paste cannot end early', () => {
        expect(encodePaste('ls\u001b[201~rm -rf x\u001b[200~', true)).toBe('\u001b[200~lsrm -rf x\u001b[201~');
    });
});

describe('pastedLines: the line count the confirmation states', () => {
    it('counts lines, a final line break included in the line it ends', () => {
        expect(pastedLines('one')).toBe(1);
        expect(pastedLines('one\n')).toBe(1);
        expect(pastedLines('one\r\ntwo\nthree')).toBe(3);
        expect(pastedLines('one\ntwo\n')).toBe(2);
    });
});
