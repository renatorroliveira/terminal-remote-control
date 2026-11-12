import type { PresentedHostKey } from '../../shared/connection';

export type { PresentedHostKey } from '../../shared/connection';

/** A line from one of the app's ssh helpers. */
export type HelperLine =
    { readonly kind: 'host-key'; readonly key: PresentedHostKey } | { readonly kind: 'notice'; readonly text: string };

/** Parses a helper line on ssh's stderr; ssh's own messages and other nonces give `undefined`. */
export function parseHelperLine(line: string, nonce: string): HelperLine | undefined {
    const prefix = `${nonce} `;
    if (!line.startsWith(prefix)) {
        return undefined;
    }
    const body = line.slice(prefix.length);
    if (body.startsWith('NOTICE ')) {
        return { kind: 'notice', text: body.slice('NOTICE '.length) };
    }
    const [word, host, type, key, fingerprint] = body.split(' ');
    if (
        word !== 'HOSTKEY' ||
        host === undefined ||
        type === undefined ||
        key === undefined ||
        fingerprint === undefined
    ) {
        return undefined;
    }
    return { kind: 'host-key', key: { host, type, key, fingerprint } };
}

/** ssh's stderr without the helper lines: what the user sees and copies as details (US-1.3.3). */
export function shownDetails(stderr: readonly string[], nonce: string): string {
    return stderr.filter((line) => !line.startsWith(`${nonce} `)).join('\n');
}
