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

/** The fuses `electron-builder.yml` sets under `electronFuses` (TECH_STACK §4.5). */
export function expectedFuses(builderYaml: string): FuseStates {
    const lines = builderYaml.split('\n');
    const start = lines.findIndex((line) => line.trim() === 'electronFuses:');
    const block = lines.slice(start + 1);
    const end = block.findIndex((line) => !FUSE_LINE.test(line));
    const entries = block.slice(0, end === -1 ? block.length : end).map((line) => {
        const [, name = '', value] = FUSE_LINE.exec(line) ?? [];
        return [name, value === 'true'] as const;
    });
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

/** Each socket in `lsof` output, which a release build must never have (SEC-01). */
export function listenerProblems(lsofOutput: string): readonly string[] {
    return lsofOutput
        .split('\n')
        .slice(1)
        .filter((line) => line.trim() !== '')
        .map((line) => {
            const fields = line.trim().split(/\s+/);
            return `socket open: ${[fields[0], fields[1], ...fields.slice(7)].join(' ')}`;
        });
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

function onOff(on: boolean): string {
    return on ? 'on' : 'off';
}
