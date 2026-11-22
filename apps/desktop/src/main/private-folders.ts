import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';

/** Runs a program hidden and resolves with whether it succeeded. */
export type RunProgram = (program: string, args: readonly string[]) => Promise<boolean>;

/** How {@link makeFoldersPrivate} works on this OS. */
export interface PrivateFolderOptions {
    readonly platform: NodeJS.Platform;
    /** The bundled `trcd.exe`, on Windows. */
    readonly trcd: string;
    readonly run?: RunProgram;
}

const HELPER_TIMEOUT_MS = 10_000;

/**
 * Makes each folder private to the user (SEC-02, SEC-05): created with mode 0700, and on Windows, where modes do not
 * apply, given a protected ACL that grants only the user, inherited by every file inside, and marked not content
 * indexed, by the bundled `trcd.exe` (D-68). It runs at every launch, so a folder whose ACL changed is put back.
 * Resolves with the folders it could not make private.
 */
export async function makeFoldersPrivate(
    folders: readonly string[],
    { platform, trcd, run = runHidden }: PrivateFolderOptions,
): Promise<readonly string[]> {
    const failed: string[] = [];
    for (const folder of folders) {
        await mkdir(folder, { recursive: true, mode: 0o700 });
        if (platform === 'win32' && !(await run(trcd, ['private-dir', folder]))) {
            failed.push(folder);
        }
    }
    return failed;
}

function runHidden(program: string, args: readonly string[]): Promise<boolean> {
    return new Promise((resolve) => {
        execFile(program, [...args], { windowsHide: true, timeout: HELPER_TIMEOUT_MS }, (error) => {
            resolve(error === null);
        });
    });
}
