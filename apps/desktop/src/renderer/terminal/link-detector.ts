/** A link found in plain text: where it sits, as UTF-16 offsets, and what it opens. */
export interface TextLink {
    readonly start: number;
    readonly end: number;
    readonly target: string;
}

const URL_PATTERN =
    /\b(?:[a-z][a-z0-9+.-]{0,31}:\/\/|mailto:)[^\s<>"'`{}|\\^\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?]$/;
const CLOSERS: Readonly<Record<string, string>> = { ')': '(', ']': '[' };

/** The URLs of any scheme, and `mailto:` links, in `text` (US-1.12.3). */
export function detectLinks(text: string): readonly TextLink[] {
    return Array.from(text.matchAll(URL_PATTERN), (match) => {
        const target = trimEnd(match[0]);
        return { start: match.index, end: match.index + target.length, target };
    });
}

/** Drops sentence punctuation and closing brackets the URL did not open. */
function trimEnd(candidate: string): string {
    let target = candidate;
    for (;;) {
        const last = target.slice(-1);
        const opener = CLOSERS[last];
        const unbalanced = opener !== undefined && count(target, last) > count(target, opener);
        if (!unbalanced && !TRAILING_PUNCTUATION.test(target)) {
            return target;
        }
        target = target.slice(0, -1);
    }
}

function count(text: string, character: string): number {
    return text.split(character).length - 1;
}
