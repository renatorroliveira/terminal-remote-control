/**
 * Checks a packaged Terminal Remote Control.app before it ships (ST-20, SEC-01, SEC-04.2, P-11, P-14): the ad-hoc
 * signature, the fuses, no test seam in the bundle, the third-party notices, the bundled daemons against their manifest, and that the app,
 * launched in the background with every debugging switch, opens no listening TCP socket and no UDP socket. On Windows
 * it checks a zip, the installer or an unpacked app instead (`verify-windows.ts`, P-87). Run
 * `pnpm verify:artifact <path>`.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
    DAEMON_PLATFORMS,
    descendants,
    expectedFuses,
    fuseProblems,
    listenerProblems,
    lsofVisibilityProblems,
    manifestProblems,
    seamProblems,
    signatureProblems,
} from './checks.ts';
import { bundleText, daemonFiles, fuseStates, run } from './package-files.ts';
import { verifyWindowsArtifact } from './verify-windows.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const LAUNCH_TIMEOUT_MS = 30_000;
const SETTLE_MS = 3_000;

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
            daemonFiles(resources, DAEMON_PLATFORMS),
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
    const main = pids[0] ?? 0;
    return [
        ...lsofVisibilityProblems(run('lsof', ['-nP', '-a', '-p', String(main), '-d', 'cwd', '-F', 'n']), main),
        ...listenerProblems(run('lsof', ['-nP', '-a', '-p', list, '-iTCP', '-sTCP:LISTEN', '-F', 'pcn'])),
        ...listenerProblems(run('lsof', ['-nP', '-a', '-p', list, '-iUDP', '-F', 'pcn'])),
    ];
}

function plist(app: string, key: string): string {
    return run('plutil', ['-extract', key, 'raw', join(app, 'Contents/Info.plist')]).output;
}

if (import.meta.main) {
    const [app] = process.argv.slice(2);
    if (app === undefined) {
        throw new Error('usage: pnpm verify:artifact <the .app on macOS; a zip, -setup.exe or app folder on Windows>');
    }
    const problems =
        process.platform === 'win32' ? await verifyWindowsArtifact(resolve(app)) : await verifyArtifact(resolve(app));
    for (const problem of problems) {
        process.stderr.write(`✗ ${problem}\n`);
    }
    process.stdout.write(problems.length === 0 ? `✓ ${app} may ship\n` : '');
    process.exitCode = problems.length === 0 ? 0 : 1;
}
