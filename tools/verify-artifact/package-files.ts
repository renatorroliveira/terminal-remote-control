import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { FuseV1Options, getCurrentFuseWire } from '@electron/fuses';
import type { DaemonFile, FuseStates } from './checks.ts';

const FUSE_ENABLED = 49;

/** A command's exit status, its stdout, its stderr, and all its output, stdout then stderr. */
export interface Ran {
    readonly status: number | null;
    readonly stdout: string;
    readonly stderr: string;
    readonly output: string;
}

/** Runs a command to its end, hidden on Windows (S9); codesign -dv reports on stderr, hence `output`. */
export function run(command: string, args: readonly string[]): Ran {
    const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
    return {
        status: result.status,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
    };
}

/** The fuse states an Electron binary carries: the app bundle on macOS, the program on Windows. */
export async function fuseStates(binary: string): Promise<FuseStates> {
    const wire = (await getCurrentFuseWire(binary)) as unknown as Readonly<Record<number, number>>;
    const names = Object.entries(FuseV1Options).filter(
        (entry): entry is [string, number] => typeof entry[1] === 'number',
    );
    return Object.fromEntries(
        names
            .filter(([, index]) => wire[index] !== undefined)
            .map(([name, index]) => [name[0]?.toLowerCase() + name.slice(1), wire[index] === FUSE_ENABLED]),
    );
}

/** The text of the app's archive and of every file unpacked beside it, where a test seam would show. */
export function bundleText(resources: string): string {
    const unpacked = join(resources, 'app.asar.unpacked');
    const files = [join(resources, 'app.asar'), ...(existsSync(unpacked) ? filesUnder(unpacked) : [])];
    return files.map((file) => readFileSync(file, 'latin1')).join('\n');
}

/** Each bundled daemon's digest and size, by platform; Windows' is `trcd.exe` (D-66). */
export function daemonFiles(
    resources: string,
    platforms: readonly string[],
): Readonly<Record<string, DaemonFile | undefined>> {
    return Object.fromEntries(
        platforms.map((platform) => {
            const path = join(resources, 'daemon', platform, platform.startsWith('windows-') ? 'trcd.exe' : 'trcd');
            if (!existsSync(path)) {
                return [platform, undefined];
            }
            const bytes = readFileSync(path);
            return [platform, { sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length }];
        }),
    );
}

function filesUnder(folder: string): readonly string[] {
    return readdirSync(folder, { recursive: true, encoding: 'utf8' })
        .map((entry) => join(folder, entry))
        .filter((path) => statSync(path).isFile());
}
