/** The fuse states the app's Electron binary can carry, by camel-case fuse name. */
export type FuseStates = Readonly<Record<string, boolean>>;

/** A daemon binary's digest and size. */
export interface DaemonFile {
    readonly sha256: string;
    readonly size: number;
}

/** The daemon platforms every release bundles (US-1.4.2). */
const DAEMON_PLATFORMS = ['linux-x64', 'linux-arm64'] as const;
const FUSE_LINE = /^\s+(\w+):\s*(true|false)\s*$/;
const SEAM_NAME = /TRC_TEST_[A-Z_]+/g;

/** An `lsof` run: its exit status and output. */
export interface LsofRun {
    readonly status: number | null;
    readonly stdout: string;
    readonly stderr: string;
}

/**
 * The fuses `electron-builder.yml` sets under `electronFuses` (TECH_STACK §4.5). It throws when the block is missing,
 * empty or holds a line that is not a fuse, so the fuse check can never pass by expecting nothing.
 */
export function expectedFuses(builderYaml: string): FuseStates {
    const lines = builderYaml.split('\n');
    const start = lines.findIndex((line) => line.trim() === 'electronFuses:');
    const rest = start === -1 ? [] : lines.slice(start + 1);
    const end = rest.findIndex((line) => line.trim() !== '' && !/^\s/.test(line));
    const block = rest.slice(0, end === -1 ? rest.length : end);
    const entries = block.flatMap((line, index) => fuseEntry(line, index));
    if (entries.length === 0) {
        throw new Error('electron-builder.yml sets no electronFuses');
    }
    return Object.fromEntries(entries);
}

/** Each expected fuse that the binary has in another state, or not at all. */
export function fuseProblems(actual: FuseStates, expected: FuseStates): readonly string[] {
    return Object.entries(expected).flatMap(([name, on]) => {
        const state = actual[name];
        if (state === undefined) {
            return [`fuse ${name} is missing, expected ${onOff(on)}`];
        }
        return state === on ? [] : [`fuse ${name} is ${onOff(state)}, expected ${onOff(on)}`];
    });
}

/** Each test seam variable name left in the app bundle's text (P-14). */
export function seamProblems(bundleText: string): readonly string[] {
    const names = new Set(bundleText.match(SEAM_NAME) ?? []);
    return [...names].map((name) => `test seam variable ${name} is in the app bundle`);
}

/** How the bundled daemons differ from `manifest.json` and the app version (SEC-04.2). */
export function manifestProblems(
    manifestText: string,
    files: Readonly<Record<string, DaemonFile | undefined>>,
    appVersion: string,
): readonly string[] {
    const manifest = JSON.parse(manifestText) as {
        readonly version: string;
        readonly binaries: Readonly<Record<string, DaemonFile | undefined>>;
    };
    const version =
        manifest.version === appVersion
            ? []
            : [`daemon manifest version ${manifest.version} is not the app version ${appVersion}`];
    return [...version, ...DAEMON_PLATFORMS.flatMap((platform) => daemonProblem(platform, manifest.binaries, files))];
}

/**
 * Each socket an `lsof -F pcn` run lists, which a release build must never have (SEC-01). An lsof that failed is a
 * problem too: lsof exits 1 with no output when it finds nothing, and with a message when it breaks.
 */
export function listenerProblems(lsof: LsofRun): readonly string[] {
    if (lsof.status !== 0 && (lsof.status !== 1 || lsof.stderr.trim() !== '')) {
        return [`lsof failed (exit ${lsof.status}): ${lsof.stderr.trim()}`];
    }
    let pid = '';
    let command = '';
    return lsof.stdout.split('\n').flatMap((line) => {
        const field = line.slice(1);
        if (line.startsWith('p')) {
            pid = field;
        } else if (line.startsWith('c')) {
            command = field;
        }
        return line.startsWith('n') ? [`socket open: ${command} ${pid} ${field}`] : [];
    });
}

/** Whether lsof saw a process at all, from an `lsof -a -p <pid> -d cwd -F n` run, so an empty socket list counts. */
export function lsofVisibilityProblems(lsof: LsofRun, pid: number): readonly string[] {
    const listed = lsof.status === 0 && lsof.stdout.split('\n').some((line) => line.startsWith('n'));
    return listed ? [] : [`lsof cannot see the app’s process ${pid}, so the socket check would prove nothing`];
}

/** `root` and every process it started, from `ps -A -o pid=,ppid=` output. */
export function descendants(psOutput: string, root: number): readonly number[] {
    const pairs = psOutput
        .split('\n')
        .map((line) => line.trim().split(/\s+/).map(Number))
        .filter((pair): pair is [number, number] => pair.length === 2 && pair.every(Number.isInteger));
    const found = [root];
    for (let index = 0; index < found.length; index += 1) {
        found.push(...pairs.filter(([, parent]) => parent === found[index]).map(([pid]) => pid));
    }
    return found;
}

/** Whether `codesign -dv` describes an ad-hoc signature, as E1 ships (P-11). */
export function signatureProblems(codesignDetails: string): readonly string[] {
    return codesignDetails.split('\n').includes('Signature=adhoc') ? [] : ['the app is not ad-hoc signed'];
}

function daemonProblem(
    platform: string,
    manifest: Readonly<Record<string, DaemonFile | undefined>>,
    files: Readonly<Record<string, DaemonFile | undefined>>,
): readonly string[] {
    const listed = manifest[platform];
    const file = files[platform];
    if (listed === undefined) {
        return [`daemon ${platform} is missing from the manifest`];
    }
    if (file === undefined) {
        return [`daemon ${platform} is missing`];
    }
    return listed.sha256 === file.sha256 && listed.size === file.size
        ? []
        : [`daemon ${platform} does not match the manifest`];
}

function fuseEntry(line: string, index: number): readonly (readonly [string, boolean])[] {
    const text = line.trim();
    if (text === '' || text.startsWith('#')) {
        return [];
    }
    const match = FUSE_LINE.exec(line);
    if (match === null) {
        throw new Error(`line ${index + 1} under electronFuses is not a fuse: ${text}`);
    }
    return [[match[1] ?? '', match[2] === 'true']];
}

function onOff(on: boolean): string {
    return on ? 'on' : 'off';
}
