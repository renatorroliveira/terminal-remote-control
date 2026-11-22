import { DESTINATION_PATTERN } from '../../shared/host-address';
import { DEFAULT_KNOWN_HOSTS_FILES } from './client-checks';

/** The helper programs ssh runs for host keys and askpass. */
export interface SshHelpers {
    /** The `SSH_ASKPASS` helper. */
    readonly askpass: string;
    /** The `KnownHostsCommand` helper program. */
    readonly knownHosts: string;
    /** Arguments ahead of ssh's tokens, such as `known-hosts` for `trcd.exe` on Windows (D-66). */
    readonly knownHostsArgs?: readonly string[] | undefined;
}

/** Where to connect: a host alias or `[user@]host`, and a port the user typed. */
export interface SshTarget {
    readonly destination: string;
    readonly port?: number;
}

/** The P-14 test seam: a test SSH config and known_hosts file read ahead of the user's. Test builds only. */
export interface TestSeam {
    readonly sshConfig: string;
    readonly knownHosts: string;
}

/** What one ssh invocation needs. */
export interface SshArgumentOptions {
    /** The connection's wrapper config, passed with `-F` (D-21). */
    readonly wrapper: string;
    readonly helpers: SshHelpers;
    readonly target: SshTarget;
    /** The remote command. */
    readonly command: string;
    readonly seam?: TestSeam | undefined;
    /** The known_hosts files read instead of the user's, when theirs keep no key (US-1.2.1). */
    readonly knownHostsFiles?: readonly string[] | undefined;
    readonly logLevel?: SshLogLevel | undefined;
}

/**
 * ssh's `LogLevel`: `ERROR`, or `INFO` on Windows, whose OpenSSH reports a refused connection at the banner exchange
 * at that level only (S9).
 */
export type SshLogLevel = 'ERROR' | 'INFO';

/** What the wrapper config needs. */
export interface WrapperConfigOptions {
    readonly helpers: SshHelpers;
    readonly seam?: TestSeam | undefined;
    /** The system-wide ssh config; `/etc/ssh/ssh_config` unless the OS keeps it elsewhere. */
    readonly systemConfig?: string | undefined;
    readonly logLevel?: SshLogLevel | undefined;
}

const UNQUOTABLE = /["\n\r\0]/;
const MAX_PORT = 65_535;

/**
 * The ssh command line: the wrapper config, then every security option again with `-o`, so they take precedence
 * over the user's configuration (US-1.1.4, SEC-03, TECH_STACK §7), then the known_hosts files that replace the user's,
 * if any.
 */
export function sshArguments(options: SshArgumentOptions): string[] {
    const security = securityOptions(options.helpers, options.logLevel).flatMap(([name, value]) => [
        '-o',
        `${name}=${value}`,
    ]);
    return [
        '-F',
        options.wrapper,
        '-T',
        '-e',
        'none',
        ...security,
        ...knownHostsArguments(options),
        ...targetArguments(options.target),
        options.command,
    ];
}

/** The `ssh -G` command line that prints the effective settings for a target through the same wrapper config. */
export function effectiveConfigArguments(wrapper: string, target: SshTarget): string[] {
    return ['-F', wrapper, '-G', ...targetArguments(target)];
}

/**
 * The per-connection wrapper config (D-21): a `Host *` block with every security option, then the user's and the
 * system config. ssh keeps the first value it obtains, so jump connections, which get only `-F`, are protected too.
 * Test builds put the test config and known_hosts file ahead of the user's, never in their place (P-14).
 */
export function wrapperConfig(options: WrapperConfigOptions): string {
    const block = securityOptions(options.helpers, options.logLevel).map(([name, value]) => `    ${name} ${value}`);
    const { seam } = options;
    const knownHosts = seam === undefined ? [] : [`    UserKnownHostsFile ${seamKnownHostsFiles(seam, quote)}`];
    const testConfig = seam === undefined ? [] : [`Include ${quote(seam.sshConfig)}`];
    return [
        'Host *',
        ...block,
        ...knownHosts,
        '',
        ...testConfig,
        'Include ~/.ssh/config',
        `Include ${quoteIfSpaced(options.systemConfig ?? '/etc/ssh/ssh_config')}`,
        '',
    ].join('\n');
}

/** The environment for ssh: the app's, plus the forced askpass helper and the helpers' nonce. */
export function sshEnvironment(
    base: Readonly<Record<string, string | undefined>>,
    helpers: SshHelpers,
    nonce: string,
): Record<string, string> {
    const inherited = Object.entries(base).filter((entry): entry is [string, string] => entry[1] !== undefined);
    return {
        ...Object.fromEntries(inherited),
        SSH_ASKPASS: helpers.askpass,
        SSH_ASKPASS_REQUIRE: 'force',
        TRC_SSH_NONCE: nonce,
    };
}

/** The test known_hosts file ahead of the user's in test builds (P-14), else the files replacing the user's. */
function knownHostsArguments({ seam, knownHostsFiles }: SshArgumentOptions): string[] {
    if (seam !== undefined) {
        return ['-o', `UserKnownHostsFile=${seamKnownHostsFiles(seam, quoteIfSpaced)}`];
    }
    return knownHostsFiles === undefined
        ? []
        : ['-o', `UserKnownHostsFile=${knownHostsFiles.map(quoteIfSpaced).join(' ')}`];
}

function targetArguments({ destination, port }: SshTarget): string[] {
    if (!DESTINATION_PATTERN.test(destination)) {
        throw new Error(`The ssh destination is not valid: ${JSON.stringify(destination)}`);
    }
    if (port !== undefined && !(Number.isInteger(port) && port >= 1 && port <= MAX_PORT)) {
        throw new Error(`The ssh port must be between 1 and ${MAX_PORT}: ${port}`);
    }
    return [...(port === undefined ? [] : ['-p', String(port)]), '--', destination];
}

function securityOptions(helpers: SshHelpers, logLevel: SshLogLevel = 'ERROR'): readonly (readonly [string, string])[] {
    return [
        ['BatchMode', 'yes'],
        ['StrictHostKeyChecking', 'yes'],
        [
            'KnownHostsCommand',
            [quote(helpers.knownHosts), ...(helpers.knownHostsArgs ?? []), '%I %H %t %K %f'].join(' '),
        ],
        ['PreferredAuthentications', 'publickey'],
        ['PasswordAuthentication', 'no'],
        ['KbdInteractiveAuthentication', 'no'],
        ['ForwardAgent', 'no'],
        ['ForwardX11', 'no'],
        ['ClearAllForwardings', 'yes'],
        ['PermitLocalCommand', 'no'],
        ['ServerAliveInterval', '10'],
        ['ServerAliveCountMax', '2'],
        ['ConnectTimeout', '15'],
        ['LogLevel', logLevel],
    ];
}

/** A path in double quotes, as ssh's configuration and command lines read it; refuses what quotes cannot hold. */
export function quoteForSsh(path: string): string {
    return quote(path);
}

function quote(path: string): string {
    if (UNQUOTABLE.test(path)) {
        throw new Error(`The path cannot be quoted for ssh: ${JSON.stringify(path)}`);
    }
    return `"${path}"`;
}

function seamKnownHostsFiles(seam: TestSeam, quoted: (path: string) => string): string {
    return [quoted(seam.knownHosts), ...DEFAULT_KNOWN_HOSTS_FILES].join(' ');
}

function quoteIfSpaced(path: string): string {
    return /\s/.test(path) ? quote(path) : path;
}
