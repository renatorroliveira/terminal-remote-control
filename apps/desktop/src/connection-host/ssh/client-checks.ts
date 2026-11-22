/** An OpenSSH client version. */
export interface SshVersion {
    readonly major: number;
    readonly minor: number;
}

/** The settings of `ssh -G <destination>` the app uses. */
export interface EffectiveConfig {
    readonly user: string;
    readonly hostname: string;
    readonly port: number;
    readonly identityFiles: readonly string[];
    readonly certificateFiles: readonly string[];
    readonly knownHostsFiles: readonly string[];
    /** Whether new known_hosts entries are hashed. */
    readonly hashKnownHosts: boolean;
    /** The jump host, when the connection goes through one. */
    readonly proxyJump: string | undefined;
}

/** OpenSSH's default user known_hosts files. */
export const DEFAULT_KNOWN_HOSTS_FILES: readonly string[] = ['~/.ssh/known_hosts', '~/.ssh/known_hosts2'];

const VERSION_PATTERN = /OpenSSH_(?:for_Windows_)?(\d+)\.(\d+)/;
/**
 * What `UserKnownHostsFile` names when it keeps no key, as some generated configurations set, in lower case: Windows
 * has `NUL` where Unix has `/dev/null`, and Windows OpenSSH reads either (D-66, S9).
 */
const DISCARDING_FILES: ReadonlySet<string> = new Set(['/dev/null', 'none', 'nul']);
/** A word of `ssh -G`'s file list that starts a path: absolute, home-relative, a Windows drive or a share. */
const PATH_START = /^(?:[/~\\]|[A-Za-z]:[/\\])/;
const MINIMUM: SshVersion = { major: 8, minor: 5 };
const DEFAULT_PORT = 22;

/** Reads the version from `ssh -V` output, or `undefined` when it is not OpenSSH. */
export function parseSshVersion(text: string): SshVersion | undefined {
    const match = VERSION_PATTERN.exec(text);
    return match === null ? undefined : { major: Number(match[1]), minor: Number(match[2]) };
}

/** Whether the client has `KnownHostsCommand` with the presented key, which the host-key flow needs (8.5+). */
export function supportsKnownHostsCommand(version: SshVersion): boolean {
    return version.major > MINIMUM.major || (version.major === MINIMUM.major && version.minor >= MINIMUM.minor);
}

/**
 * The known_hosts files the app reads instead of `files` when every one of them discards keys (`/dev/null`, `none`, `NUL`):
 * OpenSSH's defaults, so a key the user accepts is kept and checked on every later connection (US-1.2.1, SEC-03),
 * instead of being asked about again. `undefined` when ssh's own files keep keys.
 */
export function replacementKnownHostsFiles(files: readonly string[]): readonly string[] | undefined {
    const discardsEveryKey = files.length > 0 && files.every((file) => DISCARDING_FILES.has(file.toLowerCase()));
    return discardsEveryKey ? DEFAULT_KNOWN_HOSTS_FILES : undefined;
}

/** Parses `ssh -G` output. */
export function parseEffectiveConfig(text: string): EffectiveConfig {
    const values = collectValues(text);
    const first = (key: string): string | undefined => values.get(key)?.[0];
    const jump = first('proxyjump');
    return {
        user: first('user') ?? '',
        hostname: first('hostname') ?? '',
        port: Number(first('port') ?? DEFAULT_PORT),
        identityFiles: values.get('identityfile') ?? [],
        certificateFiles: values.get('certificatefile') ?? [],
        knownHostsFiles: (values.get('userknownhostsfile') ?? []).flatMap(splitFileList),
        hashKnownHosts: first('hashknownhosts') === 'yes',
        proxyJump: jump === 'none' ? undefined : jump,
    };
}

/**
 * Splits `ssh -G`'s file list, which it prints unquoted with spaces between files. A word that does not start a path
 * belongs to the file before it, as a Windows profile folder may hold a space (`D:\Profiles\Ana Maria/.ssh/known_hosts`);
 * ssh prints every file expanded to an absolute path, so only a relative file, which ssh reads from its working
 * folder, would be joined to the one before.
 */
export function splitFileList(list: string): string[] {
    const files: string[] = [];
    for (const word of list.split(' ').filter(Boolean)) {
        const previous = files.at(-1);
        const startsFile = PATH_START.test(word) || DISCARDING_FILES.has(word.toLowerCase());
        if (previous === undefined || startsFile) {
            files.push(word);
        } else {
            files[files.length - 1] = `${previous} ${word}`;
        }
    }
    return files;
}

function collectValues(text: string): ReadonlyMap<string, readonly string[]> {
    const values = new Map<string, string[]>();
    for (const line of text.split(/\r?\n/)) {
        const space = line.indexOf(' ');
        if (space > 0) {
            const key = line.slice(0, space).toLowerCase();
            values.set(key, [...(values.get(key) ?? []), line.slice(space + 1)]);
        }
    }
    return values;
}
