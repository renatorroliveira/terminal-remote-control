/** Where a match sits: its line, and its UTF-16 offsets in that line. */
export interface FindMatch {
    readonly line: number;
    readonly start: number;
    readonly end: number;
}

/** Which match of how many is selected, the first being 0; or a regular expression that cannot be read. */
export type FindResult = { readonly index: number; readonly count: number } | 'invalid';

/** How to search (US-1.13.1). */
export interface FindOptions {
    readonly caseSensitive: boolean;
    readonly regex: boolean;
}

/** Every match of `query` in `lines`, in reading order, or `invalid` for a regular expression that cannot be read. */
export function findMatches(
    lines: readonly string[],
    query: string,
    options: FindOptions,
): readonly FindMatch[] | 'invalid' {
    if (query === '') {
        return [];
    }
    const pattern = compile(query, options);
    if (pattern === undefined) {
        return 'invalid';
    }
    return lines.flatMap((text, line) =>
        Array.from(text.matchAll(pattern), (match) => ({
            line,
            start: match.index,
            end: match.index + match[0].length,
        })).filter((match) => match.end > match.start),
    );
}

function compile(query: string, options: FindOptions): RegExp | undefined {
    const source = options.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
        return new RegExp(source, options.caseSensitive ? 'gu' : 'giu');
    } catch {
        return undefined;
    }
}
