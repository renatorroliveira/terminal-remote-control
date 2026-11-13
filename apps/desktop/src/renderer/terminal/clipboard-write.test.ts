import { describe, expect, it } from 'vitest';
import { MAX_CLIPBOARD_WRITE, parseClipboardRequest } from './clipboard-write';

function base64(text: string): string {
    let binary = '';
    for (const byte of new TextEncoder().encode(text)) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
}

describe('parseClipboardRequest: OSC 52 (SEC-06.1)', () => {
    it('reads a clipboard write as UTF-8 text', () => {
        expect(parseClipboardRequest(`c;${base64('héllo 👍')}`)).toEqual({ kind: 'write', text: 'héllo 👍' });
        expect(parseClipboardRequest(`;${base64('x')}`)).toEqual({ kind: 'write', text: 'x' });
    });

    it('recognizes a clipboard read, which is always refused', () => {
        expect(parseClipboardRequest('c;?')).toEqual({ kind: 'read' });
    });

    it('ignores data that is not base64, and writes larger than the limit', () => {
        expect(parseClipboardRequest('c;not base64!')).toBeUndefined();
        expect(parseClipboardRequest('c')).toBeUndefined();
        expect(parseClipboardRequest(`c;${base64('a'.repeat(MAX_CLIPBOARD_WRITE + 1))}`)).toBeUndefined();
    });
});
