const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The environment overrides typed in the New session dialog (US-1.7.2): one `NAME=value` per line, where `NAME=`
 * with nothing after it removes the variable. Blank lines are skipped; any other line makes the whole text invalid.
 */
export function parseEnvironment(text: string): Readonly<Record<string, string | null>> | undefined {
    const entries: [string, string | null][] = [];
    for (const line of text.split('\n').map((entry) => entry.trim())) {
        if (line === '') {
            continue;
        }
        const equals = line.indexOf('=');
        const name = equals === -1 ? '' : line.slice(0, equals).trim();
        if (!NAME.test(name)) {
            return undefined;
        }
        const value = line.slice(equals + 1).trim();
        entries.push([name, value === '' ? null : value]);
    }
    return Object.fromEntries(entries);
}
