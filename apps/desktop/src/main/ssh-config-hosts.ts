import { readdir, readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';

/** A `Host` name or an `Include` path, in the order a configuration file has them. */
export type SshConfigEntry = { readonly host: string } | { readonly include: string };

/** Where the configuration files come from. */
export interface SshConfigSources {
    /** The test seam's SSH config (P-14); release builds have none. */
    readonly testConfig: string | undefined;
    readonly home: string;
}

/** OpenSSH stops following `Include` deeper than this. */
const MAX_DEPTH = 16;
const PATTERN = /[*?!]/;

/**
 * The `Host` names the user can connect to, from the SSH configuration files given (`~/.ssh/config`, after the test
 * seam's file in test builds) and every file they `Include`, in order and without repeats (US-1.1.1). Patterns and
 * negations are not hosts and are left out. It only reads: the app never changes the user's SSH setup.
 */
export async function sshConfigHosts(files: readonly string[], home: string): Promise<readonly string[]> {
    const found = new Set<string>();
    const visited = new Set<string>();
    for (const file of files) {
        await collect(file, { home, found, visited }, 0);
    }
    return [...found];
}

/** The files to read: `~/.ssh/config`, after the P-14 seam's file in a test build. */
export function sshConfigFilesFor({ testConfig, home }: SshConfigSources): readonly string[] {
    return [...(testConfig === undefined ? [] : [testConfig]), join(home, '.ssh', 'config')];
}

/** The `Host` names and `Include` paths in one configuration file's text, in order. */
export function parseSshConfig(text: string): readonly SshConfigEntry[] {
    return text.split('\n').flatMap((line): readonly SshConfigEntry[] => {
        const [keyword, ...values] = words(line);
        const lowered = keyword?.toLowerCase();
        if (lowered === 'host') {
            return values.filter((value) => !PATTERN.test(value)).map((host) => ({ host }));
        }
        return lowered === 'include' ? values.map((include) => ({ include })) : [];
    });
}

interface Collection {
    readonly home: string;
    readonly found: Set<string>;
    readonly visited: Set<string>;
}

async function collect(file: string, collection: Collection, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || collection.visited.has(file)) {
        return;
    }
    collection.visited.add(file);
    const text = await readFile(file, 'utf8').catch(() => undefined);
    if (text === undefined) {
        return;
    }
    for (const entry of parseSshConfig(text)) {
        if ('host' in entry) {
            collection.found.add(entry.host);
            continue;
        }
        for (const path of await expand(entry.include, collection.home)) {
            await collect(path, collection, depth + 1);
        }
    }
}

async function expand(include: string, home: string): Promise<readonly string[]> {
    const path = resolveInclude(include, home);
    const name = basename(path);
    if (!/[*?]/.test(name)) {
        return [path];
    }
    const pattern = new RegExp(
        `^${name
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replaceAll('*', '.*')
            .replaceAll('?', '.')}$`,
    );
    const entries = await readdir(dirname(path)).catch(() => [] as string[]);
    return entries
        .filter((entry) => pattern.test(entry))
        .sort()
        .map((entry) => join(dirname(path), entry));
}

function resolveInclude(include: string, home: string): string {
    if (include.startsWith('~/')) {
        return join(home, include.slice(2));
    }
    return isAbsolute(include) ? include : join(home, '.ssh', include);
}

function words(line: string): readonly string[] {
    const uncommented = line.replace(/(^|\s)#.*$/, '').trim();
    return uncommented
        .replace(/^(\S+?)\s*=\s*/, '$1 ')
        .split(/\s+/)
        .filter((word) => word !== '');
}
