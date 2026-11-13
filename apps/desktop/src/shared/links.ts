import { APP_IDENTITY } from './app-identity';

/** The longest link target the app opens. */
export const MAX_LINK_LENGTH = 8_192;

/** What the main process says about a link before it opens (US-1.12.4). */
export interface LinkCheck {
    /** The normalized target, as it will open. */
    readonly target: string;
    /** The prefix the confirmation may offer to trust, absent for a link without a host. */
    readonly origin: string | undefined;
    /** Whether the target starts with a prefix the user trusts, so it opens without asking. */
    readonly trusted: boolean;
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const AUTHORITY = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]*)(.*)$/is;
const REFUSED_SCHEMES: ReadonlySet<string> = new Set([
    'javascript:',
    'vbscript:',
    'data:',
    'blob:',
    `${APP_IDENTITY.appScheme}:`,
]);
const PREFIX_BOUNDARIES = '/?#';

/**
 * The target normalized as it will open, or undefined when the app must not open it: not an absolute URL, a scheme
 * that runs script or carries content, control characters or spaces (SEC-06.4), or longer than
 * {@link MAX_LINK_LENGTH}. Any other scheme opens in the app the OS assigns to it (US-1.12.3).
 */
export function normalizeLink(target: string): string | undefined {
    if (target.length > MAX_LINK_LENGTH || hasControlOrSpace(target) || !SCHEME.test(target)) {
        return undefined;
    }
    const url = parse(target);
    if (url === undefined || REFUSED_SCHEMES.has(url.protocol) || url.href.length > MAX_LINK_LENGTH) {
        return undefined;
    }
    return url.href;
}

/** The scheme and host of a link, such as `https://google.com`, or undefined for a link without a host. */
export function linkOrigin(target: string): string | undefined {
    const url = parse(target);
    return url === undefined || url.host === '' ? undefined : `${url.protocol}//${url.host}`;
}

/**
 * Whether `target` starts with the trusted `prefix` at a boundary: the prefix ends the target, ends with `/` or `:`,
 * or is followed by `/`, `?` or `#`, so `https://google.com` never matches `https://google.com.evil.example` or
 * `https://google.com@evil.example`. Schemes and hosts compare in any letter case.
 */
export function matchesPrefix(target: string, prefix: string): boolean {
    const canonicalTarget = canonical(target);
    const canonicalPrefix = canonical(prefix);
    if (canonicalPrefix === '' || !canonicalTarget.startsWith(canonicalPrefix)) {
        return false;
    }
    const next = canonicalTarget.charAt(canonicalPrefix.length);
    return next === '' || /[/:]$/.test(canonicalPrefix) || PREFIX_BOUNDARIES.includes(next);
}

function canonical(link: string): string {
    const authority = AUTHORITY.exec(link);
    if (authority !== null) {
        return `${authority[1]?.toLowerCase() ?? ''}${authority[2] ?? ''}`;
    }
    const scheme = SCHEME.exec(link)?.[0] ?? '';
    return `${scheme.toLowerCase()}${link.slice(scheme.length)}`;
}

function parse(target: string): URL | undefined {
    try {
        return new URL(target);
    } catch {
        return undefined;
    }
}

const SPACE_END = 0x20;
const DELETE = 0x7f;
const C1_END = 0x9f;

function hasControlOrSpace(text: string): boolean {
    for (const character of text) {
        const code = character.codePointAt(0) ?? 0;
        if (code <= SPACE_END || (code >= DELETE && code <= C1_END) || /\s/u.test(character)) {
            return true;
        }
    }
    return false;
}
