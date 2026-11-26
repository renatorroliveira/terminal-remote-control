import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
    DAEMON_PLATFORMS,
    descendants,
    expectedFuses,
    fuseProblems,
    manifestProblems,
    seamProblems,
} from './checks.ts';
import { bundleText, daemonFiles, fuseStates, run } from './package-files.ts';
import {
    asarPackageVersion,
    endpointProblems,
    parseWindowsProcesses,
    peMachine,
    runningFrom,
    type WindowsArch,
    type WindowsProcess,
    windowsDaemonPlatform,
} from './windows-checks.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const PRODUCT = 'Terminal Remote Control';
const EXECUTABLE = `${PRODUCT}.exe`;
const LAUNCH_TIMEOUT_MS = 30_000;
const SETTLE_MS = 3_000;
/** How long the silent uninstaller may take: minutes on the arm64 runner, which emulates NSIS's x86 code. */
const UNINSTALL_TIMEOUT_MS = 300_000;
/** How long the app's processes may take to end after the launch check kills them. */
const EXIT_TIMEOUT_MS = 60_000;

/**
 * Every problem a Windows package has, so none means it may ship (P-87, SEC-01, SEC-04.2): a zip is unpacked first;
 * the installer installs for the current user, is checked where it put the app, then uninstalls. The app is checked
 * for its fuses, no test seam, the notices, the daemons against their manifest with this architecture's `trcd.exe`,
 * and that, launched with every debugging switch, none of its processes listens on TCP or holds a UDP socket.
 */
export async function verifyWindowsArtifact(target: string): Promise<readonly string[]> {
    if (target.toLowerCase().endsWith('-setup.exe')) {
        return verifyInstaller(target);
    }
    if (target.toLowerCase().endsWith('.zip')) {
        const scratch = mkdtempSync(join(tmpdir(), 'trc-zip-'));
        try {
            const unpacked = run(systemTool('tar.exe'), ['-xf', target, '-C', scratch]);
            return unpacked.status === 0
                ? await verifyAppFolder(scratch)
                : [`the zip did not unpack: ${unpacked.output}`];
        } finally {
            rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
        }
    }
    return verifyAppFolder(target);
}

/** Where the per-user installer puts the app (P-87). */
function installFolder(): string {
    return join(process.env['LOCALAPPDATA'] ?? '', 'Programs', 'TRC');
}

/** The Start menu shortcut the installer adds, which carries the app's AppUserModelID (US-5.3). */
function startMenuShortcut(): string {
    return join(process.env['APPDATA'] ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', `${PRODUCT}.lnk`);
}

async function verifyInstaller(setup: string): Promise<readonly string[]> {
    const folder = installFolder();
    if (existsSync(folder)) {
        return [`${folder} already exists, so the installer cannot be checked; uninstall it first`];
    }
    const installed = run(setup, ['/S']);
    if (installed.status !== 0) {
        return [`the installer failed (exit ${installed.status}): ${installed.output}`];
    }
    if (!existsSync(join(folder, EXECUTABLE))) {
        return [`the installer put no ${EXECUTABLE} in ${folder}`];
    }
    return [
        ...(await verifyAppFolder(folder)),
        ...registrationProblems(),
        ...(existsSync(startMenuShortcut()) ? [] : ['the installer added no Start menu shortcut']),
        ...(await uninstallProblems(folder)),
    ];
}

/** Whether the installer registered the app for the current user only, as an install without elevation does. */
function registrationProblems(): readonly string[] {
    const key = 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*';
    const count = (hive: string): number =>
        Number(
            powershell(
                `@(Get-ItemProperty '${hive}:\\${key}' -ErrorAction SilentlyContinue | Where-Object DisplayName -like '${PRODUCT}*').Count`,
            ).stdout.trim(),
        );
    return [
        ...(count('HKCU') === 1 ? [] : ['the installer did not register the app for the current user']),
        ...(count('HKLM') === 0 ? [] : ['the installer registered the app for every user, which needs elevation']),
    ];
}

/** Runs the uninstaller, which copies itself away and returns at once, and waits for the app and shortcut to go. */
async function uninstallProblems(folder: string): Promise<readonly string[]> {
    const uninstaller = join(folder, `Uninstall ${PRODUCT}.exe`);
    if (!existsSync(uninstaller)) {
        return ['the installer added no uninstaller'];
    }
    const running = await stillRunning(folder, EXIT_TIMEOUT_MS);
    if (running.length > 0) {
        return [`processes ${running.join(', ')} still run from ${folder}, so nothing could uninstall it`];
    }
    const result = run(uninstaller, ['/S']);
    if (result.status !== 0) {
        return [`the uninstaller failed (exit ${result.status}): ${result.output}`];
    }
    for (let waited = 0; waited < UNINSTALL_TIMEOUT_MS; waited += 1_000) {
        if (!existsSync(join(folder, EXECUTABLE)) && !existsSync(startMenuShortcut())) {
            return [];
        }
        await delay(1_000);
    }
    const left = [join(folder, EXECUTABLE), startMenuShortcut()].filter((path) => existsSync(path));
    return [`the uninstaller left ${left.join(' and ')} after ${UNINSTALL_TIMEOUT_MS / 1_000} s`];
}

/** The processes still running from `folder` once they have had `timeout` to end. */
async function stillRunning(folder: string, timeout: number): Promise<readonly number[]> {
    for (let waited = 0; ; waited += 1_000) {
        const running = runningFrom(processes(), folder);
        if (running.length === 0 || waited >= timeout) {
            return running;
        }
        await delay(1_000);
    }
}

async function verifyAppFolder(folder: string): Promise<readonly string[]> {
    const executable = join(folder, EXECUTABLE);
    const resources = join(folder, 'resources');
    if (!existsSync(executable)) {
        return [`${executable} is missing`];
    }
    const arch = peMachine(readFileSync(executable));
    if (arch === undefined) {
        return [`${EXECUTABLE} is not an x64 or arm64 Windows program`];
    }
    const platforms = [...DAEMON_PLATFORMS, windowsDaemonPlatform(arch)];
    const builderYaml = readFileSync(join(ROOT, 'apps/desktop/electron-builder.yml'), 'utf8');
    return [
        ...fuseProblems(await fuseStates(executable), expectedFuses(builderYaml)),
        ...seamProblems(bundleText(resources)),
        ...manifestProblems(
            readFileSync(join(resources, 'daemon/manifest.json'), 'utf8'),
            daemonFiles(resources, platforms),
            asarPackageVersion(readFileSync(join(resources, 'app.asar'))) ?? 'with no version',
            platforms,
        ),
        ...helperArchProblems(resources, arch),
        ...(existsSync(join(resources, 'notices/THIRD_PARTY_NOTICES.txt'))
            ? []
            : ['the third-party notices are missing']),
        ...(await launchProblems(executable)),
    ];
}

/** Whether the bundled `trcd.exe`, which runs ssh's helpers (D-66), is built for the app's own architecture. */
function helperArchProblems(resources: string, arch: WindowsArch): readonly string[] {
    const helper = join(resources, 'daemon', windowsDaemonPlatform(arch), 'trcd.exe');
    if (!existsSync(helper)) {
        return [];
    }
    const helperArch = peMachine(readFileSync(helper));
    return helperArch === arch ? [] : [`trcd.exe is built for ${helperArch ?? 'another machine'}, not ${arch}`];
}

async function launchProblems(executable: string): Promise<readonly string[]> {
    const scratch = mkdtempSync(join(tmpdir(), 'trc-verify-'));
    const profile = join(scratch, 'profile');
    mkdirSync(join(scratch, 'home'));
    const debugging = ['--remote-debugging-port=0', '--inspect=0', '--inspect-brk=0'];
    const app = spawn(executable, [`--user-data-dir=${profile}`, ...debugging], {
        env: { ...process.env, TRC_HOME: join(scratch, 'home') },
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
    });
    app.unref();
    try {
        const main = await rendererStarted(profile);
        if (main === undefined) {
            return [`the app showed no window within ${LAUNCH_TIMEOUT_MS / 1_000} s`];
        }
        await delay(SETTLE_MS);
        const tree = processTree(processes(), main);
        if (!tree.includes(main)) {
            return ['the app exited right after launch'];
        }
        return sockets(tree);
    } finally {
        run(systemTool('taskkill.exe'), ['/PID', String(app.pid ?? 0), '/T', '/F']);
        await delay(2_000);
        rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    }
}

/** The app's main process, found by its own profile folder, once its window's renderer runs. */
async function rendererStarted(profile: string): Promise<number | undefined> {
    for (let waited = 0; waited < LAUNCH_TIMEOUT_MS; waited += 1_000) {
        const all = processes();
        const main = all.find(
            (entry) => entry.command.includes(`--user-data-dir=${profile}`) && !entry.command.includes('--type='),
        );
        if (main !== undefined) {
            const tree = new Set(processTree(all, main.pid));
            if (all.some((entry) => tree.has(entry.pid) && entry.command.includes('--type=renderer'))) {
                return main.pid;
            }
        }
        await delay(1_000);
    }
    return undefined;
}

function processes(): readonly WindowsProcess[] {
    return parseWindowsProcesses(
        powershell(
            'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress',
        ).stdout,
    );
}

function processTree(all: readonly WindowsProcess[], root: number): readonly number[] {
    const alive = all.some((entry) => entry.pid === root);
    return alive ? descendants(all.map((entry) => `${entry.pid} ${entry.ppid}`).join('\n'), root) : [];
}

/** Each listening TCP socket and UDP socket `pids` own; tables that list nothing at all prove nothing. */
function sockets(pids: readonly number[]): readonly string[] {
    const select = 'Select-Object LocalAddress,LocalPort,OwningProcess | ConvertTo-Json -Compress';
    const tcp = powershell(`Get-NetTCPConnection -State Listen | ${select}`);
    const udp = powershell(`Get-NetUDPEndpoint | ${select}`);
    if (tcp.status !== 0 || tcp.stdout.trim() === '') {
        return [`Windows listed no TCP listeners at all, so the socket check would prove nothing: ${tcp.output}`];
    }
    return [
        ...endpointProblems(tcp.stdout, pids, 'TCP listener'),
        ...(udp.status === 0 ? endpointProblems(udp.stdout, pids, 'UDP endpoint') : [`Get-NetUDPEndpoint failed`]),
    ];
}

function powershell(command: string): ReturnType<typeof run> {
    return run(systemTool('WindowsPowerShell\\v1.0\\powershell.exe'), [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        command,
    ]);
}

/** A tool in System32 by absolute path, never one a PATH entry could shadow. */
function systemTool(name: string): string {
    return join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', name);
}
