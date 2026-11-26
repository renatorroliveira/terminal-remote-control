import { execFile } from 'node:child_process';
import { mkdir, realpath } from 'node:fs/promises';
import { win32 } from 'node:path';

/** Runs a program hidden and resolves with whether it succeeded. */
export type RunProgram = (program: string, args: readonly string[]) => Promise<boolean>;

/** How {@link makeFoldersPrivate} works on this OS. */
export interface PrivateFolderOptions {
    readonly platform: NodeJS.Platform;
    /** The bundled `trcd.exe`, on Windows. */
    readonly trcd: string;
    /** The user's profile folder, which a user-only ACL must never replace. */
    readonly profile: string;
    readonly run?: RunProgram;
}

/** A folder that could not be made private, by the name it was given, and why. */
export interface PrivacyRefusal {
    readonly name: string;
    /** `shared-folder`: it holds more than TRC's state, so its ACL stays; `helper-failed`: `trcd.exe` failed. */
    readonly reason: 'shared-folder' | 'helper-failed';
}

const HELPER_TIMEOUT_MS = 10_000;

/**
 * Makes each named folder private to the user (SEC-02, SEC-05): created with mode 0700, and on Windows, where modes
 * do not apply, given a protected ACL that grants only the user, inherited by every file inside, and marked not
 * content indexed, by the bundled `trcd.exe` (D-68). It runs at every launch, so a folder whose ACL changed is put
 * back; `trcd.exe` leaves one that is still private alone. Links are resolved first, so a junction's target is what
 * becomes private. A folder that holds more than TRC's state, such as the profile or a drive root that `TRC_HOME`
 * names, keeps its ACL (P-94). Resolves with the folders it refused.
 */
export async function makeFoldersPrivate(
    folders: Readonly<Record<string, string>>,
    { platform, trcd, profile, run = runHidden }: PrivateFolderOptions,
): Promise<readonly PrivacyRefusal[]> {
    const refused: PrivacyRefusal[] = [];
    const realProfile = await realOrSelf(profile);
    for (const [name, folder] of Object.entries(folders)) {
        await mkdir(folder, { recursive: true, mode: 0o700 });
        if (platform !== 'win32') {
            continue;
        }
        const real = await realOrSelf(folder);
        if (!isDedicatedFolder(real, realProfile)) {
            refused.push({ name, reason: 'shared-folder' });
        } else if (!(await run(trcd, ['private-dir', real]))) {
            refused.push({ name, reason: 'helper-failed' });
        }
    }
    return refused;
}

/** The path with every link and short name resolved, or the path itself when it does not exist. */
async function realOrSelf(path: string): Promise<string> {
    return realpath(path).catch(() => path);
}

/**
 * Whether a Windows folder may be TRC's alone: not a drive or share root, not the profile and not a folder holding
 * it, compared as Windows compares paths, without case.
 */
export function isDedicatedFolder(folder: string, profile: string): boolean {
    const target = win32.resolve(withoutLongPrefix(folder));
    if (win32.relative(win32.parse(target).root, target) === '') {
        return false;
    }
    const toProfile = win32.relative(target, win32.resolve(withoutLongPrefix(profile)));
    return toProfile === '..' || toProfile.startsWith('..\\') || win32.isAbsolute(toProfile);
}

/** A path without Windows' `\\?\` long-path prefix, `\\?\UNC\server\share` becoming `\\server\share`. */
function withoutLongPrefix(path: string): string {
    if (/^\\\\\?\\UNC\\/i.test(path)) {
        return `\\\\${path.slice(8)}`;
    }
    return path.startsWith('\\\\?\\') ? path.slice(4) : path;
}

function runHidden(program: string, args: readonly string[]): Promise<boolean> {
    return new Promise((resolve) => {
        execFile(program, [...args], { windowsHide: true, timeout: HELPER_TIMEOUT_MS }, (error) => {
            resolve(error === null);
        });
    });
}
