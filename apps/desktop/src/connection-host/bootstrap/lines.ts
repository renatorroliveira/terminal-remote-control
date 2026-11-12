/** Why the bootstrap failed on the host, as `ERROR <code>` reports it. */
export type BootstrapErrorCode =
    | 'unsupported-os'
    | 'unsupported-arch'
    | 'missing-tool'
    | 'root-unusable'
    | 'noexec'
    | 'checksum-mismatch'
    | 'short-upload'
    | 'lock-busy'
    | 'self-test'
    | 'not-installed'
    | 'protocol'
    | 'unknown';

/** A daemon already installed on the host. */
export interface InstalledDaemon {
    /** The binary's SHA-256, which names its version directory. */
    readonly sha256: string;
    /** The version it reports. */
    readonly version: string;
}

/** The host's first report: system, checksum tool and installed daemons (US-1.4.1). */
export interface HelloLine {
    readonly kind: 'hello';
    readonly os: string;
    readonly arch: string;
    readonly checksum: string;
    readonly installed: readonly InstalledDaemon[];
}

/** A step of an upload in progress. */
export type ProgressStep = 'receiving' | 'verifying' | 'testing';

/** One line from the bootstrap script. */
export type BootstrapLine =
    | HelloLine
    | { readonly kind: 'progress'; readonly step: ProgressStep }
    | { readonly kind: 'installed'; readonly sha256: string; readonly version: string }
    | { readonly kind: 'running' }
    | { readonly kind: 'error'; readonly code: BootstrapErrorCode; readonly detail: string };

const ERROR_CODES: ReadonlySet<string> = new Set<BootstrapErrorCode>([
    'unsupported-os',
    'unsupported-arch',
    'missing-tool',
    'root-unusable',
    'noexec',
    'checksum-mismatch',
    'short-upload',
    'lock-busy',
    'self-test',
    'not-installed',
    'protocol',
]);
const PROGRESS_STEPS: ReadonlySet<string> = new Set<ProgressStep>(['receiving', 'verifying', 'testing']);
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** Parses one line of the script's output; lines without the nonce are noise and give `undefined`. */
export function parseBootstrapLine(line: string, nonce: string): BootstrapLine | undefined {
    const prefix = `${nonce} `;
    if (!line.startsWith(prefix)) {
        return undefined;
    }
    const [word, rest] = splitFirst(line.slice(prefix.length));
    switch (word) {
        case 'HELLO':
            return parseHello(rest);
        case 'PROGRESS':
            return PROGRESS_STEPS.has(rest)
                ? { kind: 'progress', step: rest as ProgressStep }
                : protocolError('malformed PROGRESS line');
        case 'INSTALLED':
            return parseInstalled(rest);
        case 'RUNNING':
            return { kind: 'running' };
        case 'ERROR':
            return parseError(rest);
        default:
            return protocolError(`unknown line ${word}`);
    }
}

function parseHello(rest: string): BootstrapLine {
    const fields = new Map(
        rest
            .split(' ')
            .filter((pair) => pair.includes('='))
            .map((pair) => splitFirst(pair, '=')),
    );
    const os = fields.get('os');
    const arch = fields.get('arch');
    const checksum = fields.get('checksum');
    const installed = parseInstalledList(fields.get('installed'));
    if (os === undefined || arch === undefined || checksum === undefined || installed === undefined) {
        return protocolError('malformed HELLO line');
    }
    return { kind: 'hello', os, arch, checksum, installed };
}

function parseInstalledList(list: string | undefined): readonly InstalledDaemon[] | undefined {
    if (list === undefined || list === '-') {
        return list === undefined ? undefined : [];
    }
    const entries = list.split(',').map((entry) => splitFirst(entry, ':'));
    if (!entries.every(([sha256, version]) => SHA256_PATTERN.test(sha256) && version !== '')) {
        return undefined;
    }
    return entries.map(([sha256, version]) => ({ sha256, version }));
}

function parseInstalled(rest: string): BootstrapLine {
    const [sha256, version] = splitFirst(rest);
    return SHA256_PATTERN.test(sha256) && version !== ''
        ? { kind: 'installed', sha256, version }
        : protocolError('malformed INSTALLED line');
}

function parseError(rest: string): BootstrapLine {
    const [code, detail] = splitFirst(rest);
    return ERROR_CODES.has(code)
        ? { kind: 'error', code: code as BootstrapErrorCode, detail }
        : { kind: 'error', code: 'unknown', detail: rest };
}

function protocolError(detail: string): BootstrapLine {
    return { kind: 'error', code: 'protocol', detail };
}

function splitFirst(text: string, separator = ' '): readonly [string, string] {
    const index = text.indexOf(separator);
    return index < 0 ? [text, ''] : [text.slice(0, index), text.slice(index + separator.length)];
}
