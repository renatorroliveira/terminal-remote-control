/**
 * Checks a packaged Terminal Remote Control.app before it ships (ST-20, SEC-01, SEC-04.2, P-11, P-14): the ad-hoc
 * signature, the fuses, no test seam in the bundle, the third-party notices, the bundled daemons against their manifest, and that the app,
 * launched in the background with every debugging switch, opens no listening TCP socket and no UDP socket. Run `pnpm verify:artifact <path to the .app>`.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { FuseV1Options, getCurrentFuseWire } from '@electron/fuses';
import {
    type DaemonFile,
    descendants,
    expectedFuses,
    type FuseStates,
    fuseProblems,
    listenerProblems,
    manifestProblems,
    seamProblems,
    signatureProblems,
} from './checks.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const FUSE_ENABLED = 49;
const LAUNCH_TIMEOUT_MS = 30_000;
const SETTLE_MS = 3_000;

interface Ran {
    readonly status: number | null;
    readonly stdout: string;
    readonly output: string;
}

/** Every problem the packaged app has; none means it may ship. */
export async function verifyArtifact(app: string): Promise<readonly string[]> {
    const builderYaml = readFileSync(join(ROOT, 'apps/desktop/electron-builder.yml'), 'utf8');
    const resources = join(app, 'Contents/Resources');
    return [
        ...signatureProblems(run('codesign', ['-dv', app]).output),
        ...verifySignature(app),
        ...fuseProblems(await fuseStates(app), expectedFuses(builderYaml)),
        ...seamProblems(bundleText(resources)),
        ...manifestProblems(
            readFileSync(join(resources, 'daemon/manifest.json'), 'utf8'),
            daemonFiles(resources),
            plist(app, 'CFBundleShortVersionString'),
        ),
        ...(existsSync(join(resources, 'notices/THIRD_PARTY_NOTICES.txt'))
            ? []
            : ['the third-party notices are missing']),
        ...(await launchProblems(app)),
    ];
}

function verifySignature(app: string): readonly string[] {
    const result = run('codesign', ['--verify', '--deep', '--strict', app]);
    return result.status === 0 ? [] : [`the signature does not verify: ${result.output}`];
}

async function fuseStates(app: string): Promise<FuseStates> {
    const wire = (await getCurrentFuseWire(app)) as unknown as Readonly<Record<number, number>>;
    const names = Object.entries(FuseV1Options).filter(
        (entry): entry is [string, number] => typeof entry[1] === 'number',
    );
    return Object.fromEntries(
        names
            .filter(([, index]) => wire[index] !== undefined)
            .map(([name, index]) => [name[0]?.toLowerCase() + name.slice(1), wire[index] === FUSE_ENABLED]),
    );
}

function bundleText(resources: string): string {
    const unpacked = join(resources, 'app.asar.unpacked');
    const files = [join(resources, 'app.asar'), ...(existsSync(unpacked) ? filesUnder(unpacked) : [])];
    return files.map((file) => readFileSync(file, 'latin1')).join('\n');
}

function filesUnder(folder: string): readonly string[] {
    return readdirSync(folder, { recursive: true, encoding: 'utf8' })
        .map((entry) => join(folder, entry))
        .filter((path) => statSync(path).isFile());
}

function daemonFiles(resources: string): Readonly<Record<string, DaemonFile | undefined>> {
    return Object.fromEntries(
        ['linux-x64', 'linux-arm64'].map((platform) => {
            const path = join(resources, 'daemon', platform, 'trcd');
            if (!existsSync(path)) {
                return [platform, undefined];
            }
            const bytes = readFileSync(path);
            return [platform, { sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length }];
        }),
    );
}

async function launchProblems(app: string): Promise<readonly string[]> {
    const scratch = mkdtempSync(join(tmpdir(), 'trc-verify-'));
    const profile = join(scratch, 'profile');
    const debugging = ['--remote-debugging-port=0', '--inspect=0', '--inspect-brk=0'];
    run('open', [
        '-g',
        '-n',
        '--env',
        `TRC_HOME=${join(scratch, 'home')}`,
        '-a',
        app,
        '--args',
        `--user-data-dir=${profile}`,
        ...debugging,
    ]);
    try {
        const pid = await rendererStarted(profile);
        if (pid === undefined) {
            return [`the app showed no window within ${LAUNCH_TIMEOUT_MS / 1_000} s`];
        }
        await delay(SETTLE_MS);
        if (run('kill', ['-0', String(pid)]).status !== 0) {
            return ['the app exited right after launch'];
        }
        return sockets(descendants(run('ps', ['-A', '-o', 'pid=,ppid=']).output, pid));
    } finally {
        run('pkill', ['-TERM', '-f', '--', `--user-data-dir=${profile}`]);
        await delay(2_000);
        rmSync(scratch, { recursive: true, force: true });
    }
}

/** The app's main process, found by its own profile folder, once its window's renderer runs. */
async function rendererStarted(profile: string): Promise<number | undefined> {
    for (let waited = 0; waited < LAUNCH_TIMEOUT_MS; waited += 500) {
        const main = run('pgrep', ['-lf', '--', `--user-data-dir=${profile}`])
            .stdout.split('\n')
            .find((line) => line.trim() !== '' && !line.includes('--type='));
        const pid = main === undefined ? undefined : Number.parseInt(main, 10);
        if (pid !== undefined && processTree(pid).includes('--type=renderer')) {
            return pid;
        }
        await delay(500);
    }
    return undefined;
}

/** The command lines of `pid` and every process it started. */
function processTree(pid: number): string {
    const tree = descendants(run('ps', ['-A', '-o', 'pid=,ppid=']).stdout, pid);
    return run('ps', ['-o', 'command=', '-p', tree.join(',')]).stdout;
}

function sockets(pids: readonly number[]): readonly string[] {
    const list = pids.join(',');
    return [
        ...listenerProblems(run('lsof', ['-nP', '-a', '-p', list, '-iTCP', '-sTCP:LISTEN']).stdout),
        ...listenerProblems(run('lsof', ['-nP', '-a', '-p', list, '-iUDP']).stdout),
    ];
}

function plist(app: string, key: string): string {
    return run('plutil', ['-extract', key, 'raw', join(app, 'Contents/Info.plist')]).output;
}

/** A command's exit status, its stdout, and all its output, stdout then stderr (codesign -dv reports on stderr). */
function run(command: string, args: readonly string[]): Ran {
    const result = spawnSync(command, args, { encoding: 'utf8' });
    return { status: result.status, stdout: result.stdout, output: `${result.stdout}${result.stderr}`.trim() };
}

if (import.meta.main) {
    const [app] = process.argv.slice(2);
    if (app === undefined) {
        throw new Error('usage: pnpm verify:artifact <path to Terminal Remote Control.app>');
    }
    const problems = await verifyArtifact(resolve(app));
    for (const problem of problems) {
        process.stderr.write(`✗ ${problem}\n`);
    }
    process.stdout.write(problems.length === 0 ? `✓ ${app} may ship\n` : '');
    process.exitCode = problems.length === 0 ? 0 : 1;
}
