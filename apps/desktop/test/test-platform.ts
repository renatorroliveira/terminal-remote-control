import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import type { ConnectionRuntime } from '../src/connection-host/connection/host-connection';
import { platformSsh } from '../src/connection-host/ssh/platform-ssh';
import { type CommandId, defaultKeymap, keymapPlatformOf, parseChord } from '../src/shared/keymap';

/** Playwright's names for the keymap's keys that differ. */
const PLAYWRIGHT_KEYS: Readonly<Record<string, string>> = {
    Up: 'ArrowUp',
    Down: 'ArrowDown',
    Left: 'ArrowLeft',
    Right: 'ArrowRight',
    ',': 'Comma',
    '.': 'Period',
    '=': 'Equal',
    '-': 'Minus',
};

/**
 * The Playwright keys of `command`'s default shortcut on `platform` (docs/design/keymap.md), such as
 * `Control+Shift+T` on Windows and `Meta+T` on macOS.
 */
export function shortcutKeys(command: CommandId, platform: string = process.platform): string {
    const chord = parseChord(defaultKeymap(keymapPlatformOf(platform))[command] ?? '');
    if (chord === undefined) {
        throw new Error(`${command} has no default shortcut`);
    }
    const modifiers = [
        chord.ctrl ? 'Control' : '',
        chord.option ? 'Alt' : '',
        chord.shift ? 'Shift' : '',
        chord.cmd ? 'Meta' : '',
    ].filter((modifier) => modifier !== '');
    return [...modifiers, PLAYWRIGHT_KEYS[chord.key] ?? chord.key].join('+');
}

/** A process: its ID, its parent's, and its command line. */
export interface TestProcess {
    readonly pid: number;
    readonly ppid: number;
    readonly command: string;
}

/** A socket a process holds: its owner and its local address, as `127.0.0.1:9222`. */
export interface OpenSocket {
    readonly pid: number;
    readonly name: string;
}

/** A program in Windows' System32, by its full path, so no folder on PATH can stand in for it. */
function system32(program: string): string {
    return `${process.env['SystemRoot'] ?? 'C:\\Windows'}\\System32\\${program}`;
}

/** Runs a PowerShell command hidden and returns what it printed. */
function powershell(command: string): string {
    return execFileSync(
        system32('WindowsPowerShell\\v1.0\\powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-Command', command],
        {
            encoding: 'utf8',
            windowsHide: true,
        },
    );
}

/** The rows of PowerShell's JSON, which prints one row as an object and none as nothing. */
function jsonRows(json: string): readonly Readonly<Record<string, unknown>>[] {
    if (json.trim() === '') {
        return [];
    }
    const parsed = JSON.parse(json) as Record<string, unknown> | Record<string, unknown>[];
    return Array.isArray(parsed) ? parsed : [parsed];
}

/** Every process on this computer, from Windows' process table or `ps`. */
export function processTable(): readonly TestProcess[] {
    if (process.platform !== 'win32') {
        return execFileSync('ps', ['-A', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' })
            .split('\n')
            .flatMap((line) => {
                const match = /^\s*(\d+)\s+(\d+)\s?(.*)$/.exec(line);
                return match === null
                    ? []
                    : [{ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] ?? '' }];
            });
    }
    const json = powershell(
        'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress',
    );
    return jsonRows(json).map((row) => ({
        pid: Number(row['ProcessId']),
        ppid: Number(row['ParentProcessId']),
        command: typeof row['CommandLine'] === 'string' ? row['CommandLine'] : '',
    }));
}

/** `root` and every process it started. */
export function processTree(root: number): readonly number[] {
    const table = processTable();
    const tree = [root];
    for (let index = 0; index < tree.length; index += 1) {
        tree.push(...table.filter((entry) => entry.ppid === tree[index]).map((entry) => entry.pid));
    }
    return tree;
}

/**
 * Kills every process whose command line holds all of `needles`, as `pkill -f` does, such as a test's ssh by its
 * scratch folder and `known_hosts`; Windows ends them with TerminateProcess. Returns how many it killed.
 */
export function killMatching(needles: readonly string[]): number {
    const doomed = processTable().filter(
        (entry) => entry.pid !== process.pid && needles.every((needle) => entry.command.includes(needle)),
    );
    for (const entry of doomed) {
        try {
            process.kill(entry.pid, 'SIGTERM');
        } catch {}
    }
    return doomed.length;
}

/** The listening TCP sockets, or the UDP sockets, that `pids` own, from Windows' tables or lsof. */
export function openSockets(pids: readonly number[], kind: 'tcp-listen' | 'udp'): readonly OpenSocket[] {
    if (process.platform === 'win32') {
        const command = kind === 'tcp-listen' ? 'Get-NetTCPConnection -State Listen' : 'Get-NetUDPEndpoint';
        const json = powershell(
            `${command} -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,OwningProcess | ConvertTo-Json -Compress`,
        );
        return jsonRows(json)
            .filter((row) => pids.includes(Number(row['OwningProcess'])))
            .map((row) => ({ pid: Number(row['OwningProcess']), name: `${row['LocalAddress']}:${row['LocalPort']}` }));
    }
    const filter = kind === 'tcp-listen' ? ['-iTCP', '-sTCP:LISTEN'] : ['-iUDP'];
    let out = '';
    try {
        out = execFileSync('lsof', ['-nP', '-a', '-p', pids.join(','), ...filter, '-F', 'pn'], { encoding: 'utf8' });
    } catch (error) {
        out = (error as { readonly stdout?: string }).stdout ?? '';
    }
    let pid = 0;
    return out.split('\n').flatMap((line) => {
        if (line.startsWith('p')) {
            pid = Number(line.slice(1));
            return [];
        }
        return line.startsWith('n') ? [{ pid, name: line.slice(1) }] : [];
    });
}

/**
 * The Electron main process of an app Playwright launched as `launched`: on Windows Playwright starts Electron through
 * `cmd.exe /d /s /c`, so `app.process()` is the shell and the main process is its child.
 */
export function electronMainPid(launched: number): number {
    if (process.platform !== 'win32') {
        return launched;
    }
    return processTable().find((entry) => entry.ppid === launched)?.pid ?? launched;
}

/**
 * Force-kills an app Playwright launched as `pid`. On Windows it ends the whole tree, as Task Manager's End task does,
 * since `pid` is the `cmd.exe` Playwright starts Electron through (see {@link electronMainPid}).
 */
export function forceKill(pid: number): void {
    if (process.platform === 'win32') {
        execFileSync(system32('taskkill.exe'), ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
        return;
    }
    process.kill(pid, 'SIGKILL');
}

/** The modifier a click opens a link with: Command on macOS, Ctrl elsewhere (US-1.12.3). */
export function linkClickModifier(platform: string = process.platform): 'Meta' | 'Control' {
    return platform === 'darwin' ? 'Meta' : 'Control';
}

/** The app's bundled resources in the repository. */
const RESOURCES = resolve(import.meta.dirname, '../resources');

/** The ssh, ssh-add and ssh-keygen the live tests run directly: Windows' own by absolute path (D-66), else PATH's. */
export function testSshTool(name: 'ssh' | 'ssh-add' | 'ssh-keygen'): string {
    return process.platform === 'win32'
        ? join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'OpenSSH', `${name}.exe`)
        : name;
}

/**
 * docker's `--context` for the test hosts: colima's `trc` profile on macOS unless `DOCKER_CONTEXT` names another, and
 * the current context elsewhere, such as Docker Desktop's on Windows (D-69).
 */
export function dockerContextArguments(): readonly string[] {
    const context = process.env['DOCKER_CONTEXT'] ?? (process.platform === 'darwin' ? 'colima-trc' : undefined);
    return context === undefined ? [] : ['--context', context];
}

/** The ssh, helpers and system config a test runtime uses on this OS, as the app's runtime picks them. */
export function testRuntimeSsh(): Pick<ConnectionRuntime, 'ssh' | 'helpers' | 'systemSshConfig' | 'sshLogLevel'> {
    const { ssh, helpers, systemConfig, logLevel } = platformSsh(process.platform, RESOURCES);
    return { ssh, helpers, systemSshConfig: systemConfig, sshLogLevel: logLevel };
}
