import { MAX_CLIPBOARD_WRITE } from '../../shared/clipboard';

export { MAX_CLIPBOARD_WRITE } from '../../shared/clipboard';

/** A program's OSC 52 request: a write of text, or a read, which is always refused (SEC-06.1). */
export type ClipboardRequest = { readonly kind: 'write'; readonly text: string } | { readonly kind: 'read' };

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const DECODER = new TextDecoder('utf-8', { fatal: true });

/** The request in OSC 52 data (`Pc;Pd`), or undefined when it is malformed or larger than the limit. */
export function parseClipboardRequest(data: string): ClipboardRequest | undefined {
    const separator = data.indexOf(';');
    const payload = separator < 0 ? undefined : data.slice(separator + 1);
    if (payload === '?') {
        return { kind: 'read' };
    }
    if (payload === undefined || !BASE64.test(payload) || payload.length > (MAX_CLIPBOARD_WRITE * 4) / 3 + 4) {
        return undefined;
    }
    const text = decode(payload);
    return text === undefined || text.length > MAX_CLIPBOARD_WRITE ? undefined : { kind: 'write', text };
}

function decode(payload: string): string | undefined {
    try {
        return DECODER.decode(Uint8Array.from(atob(payload), (character) => character.charCodeAt(0)));
    } catch {
        return undefined;
    }
}
