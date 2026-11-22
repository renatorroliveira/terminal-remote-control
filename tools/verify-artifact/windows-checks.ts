/** A Windows process: its ID, its parent's, and its command line. */
export interface WindowsProcess {
    readonly pid: number;
    readonly ppid: number;
    readonly command: string;
}

/** The architectures a Windows package ships for (P-87). */
export type WindowsArch = 'x64' | 'arm64';

const PE_MACHINES: ReadonlyMap<number, WindowsArch> = new Map([
    [0x8664, 'x64'],
    [0xaa64, 'arm64'],
]);

/** The machine a Windows executable is built for, from its PE header, or undefined for other bytes. */
export function peMachine(bytes: Buffer): WindowsArch | undefined {
    if (bytes.length < 0x40 || bytes.toString('latin1', 0, 2) !== 'MZ') {
        return undefined;
    }
    const header = bytes.readUInt32LE(0x3c);
    if (header + 6 > bytes.length || bytes.toString('latin1', header, header + 4) !== 'PE\0\0') {
        return undefined;
    }
    return PE_MACHINES.get(bytes.readUInt16LE(header + 4));
}

/** The daemon platform a Windows package of `arch` bundles beside the Linux and macOS daemons (D-66). */
export function windowsDaemonPlatform(arch: WindowsArch): string {
    return `windows-${arch}`;
}

/**
 * The version in an `app.asar` archive's `package.json`, or undefined when it has none. An archive is a size pickle,
 * a JSON header pickle naming each file's size and offset, then the files' bytes.
 */
export function asarPackageVersion(archive: Buffer): string | undefined {
    const headerPickle = archive.readUInt32LE(4);
    const headerLength = archive.readUInt32LE(12);
    const header = JSON.parse(archive.toString('utf8', 16, 16 + headerLength)) as {
        readonly files: Readonly<Record<string, { readonly size: number; readonly offset: string } | undefined>>;
    };
    const entry = header.files['package.json'];
    if (entry === undefined) {
        return undefined;
    }
    const start = 8 + headerPickle + Number(entry.offset);
    const json = JSON.parse(archive.toString('utf8', start, start + entry.size)) as { readonly version?: string };
    return json.version;
}

/** The processes in PowerShell's JSON for `Win32_Process`, which prints one process as an object and none as nothing. */
export function parseWindowsProcesses(json: string): readonly WindowsProcess[] {
    return jsonRows(json).map((row) => ({
        pid: Number(row['ProcessId']),
        ppid: Number(row['ParentProcessId']),
        command: typeof row['CommandLine'] === 'string' ? row['CommandLine'] : '',
    }));
}

/**
 * Each endpoint in PowerShell's JSON for `Get-NetTCPConnection` or `Get-NetUDPEndpoint` that one of `pids` owns,
 * which a release build must never have (SEC-01).
 */
export function endpointProblems(json: string, pids: readonly number[], kind: string): readonly string[] {
    return jsonRows(json)
        .filter((row) => pids.includes(Number(row['OwningProcess'])))
        .map((row) => `${kind} open: process ${row['OwningProcess']} on ${row['LocalAddress']}:${row['LocalPort']}`);
}

function jsonRows(json: string): readonly Readonly<Record<string, unknown>>[] {
    if (json.trim() === '') {
        return [];
    }
    const parsed = JSON.parse(json) as Record<string, unknown> | Record<string, unknown>[];
    return Array.isArray(parsed) ? parsed : [parsed];
}
