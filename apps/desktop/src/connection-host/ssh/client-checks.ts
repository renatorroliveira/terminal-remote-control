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

const VERSION_PATTERN = /OpenSSH_(?:for_Windows_)?(\d+)\.(\d+)/;
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
        knownHostsFiles: (values.get('userknownhostsfile') ?? []).flatMap((list) => list.split(' ').filter(Boolean)),
        hashKnownHosts: first('hashknownhosts') === 'yes',
        proxyJump: jump === 'none' ? undefined : jump,
    };
}

function collectValues(text: string): ReadonlyMap<string, readonly string[]> {
    const values = new Map<string, string[]>();
    for (const line of text.split('\n')) {
        const space = line.indexOf(' ');
        if (space > 0) {
            const key = line.slice(0, space).toLowerCase();
            values.set(key, [...(values.get(key) ?? []), line.slice(space + 1)]);
        }
    }
    return values;
}
