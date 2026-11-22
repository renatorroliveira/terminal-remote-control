import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeFoldersPrivate } from './private-folders';

describe('makeFoldersPrivate (SEC-05, D-68)', () => {
    const scratch = (): string => mkdtempSync(join(tmpdir(), 'trc-private-'));

    it('runs trcd.exe private-dir on each folder on Windows and reports the ones it refused', async () => {
        const root = scratch();
        const folders = [join(root, 'home'), join(root, 'data')];
        const calls: string[][] = [];
        const failed = await makeFoldersPrivate(folders, {
            platform: 'win32',
            trcd: 'C:\\TRC\\trcd.exe',
            run: async (program, args) => {
                calls.push([program, ...args]);
                return args[1] !== folders[1];
            },
        });
        expect(calls).toEqual(folders.map((folder) => ['C:\\TRC\\trcd.exe', 'private-dir', folder]));
        expect(failed).toEqual([folders[1]]);
        expect(folders.every((folder) => existsSync(folder))).toBe(true);
    });

    it('only creates the folders elsewhere, where their 0700 mode keeps them private', async () => {
        const folder = join(scratch(), 'home');
        let ran = false;
        const failed = await makeFoldersPrivate([folder], {
            platform: 'darwin',
            trcd: '',
            run: async () => {
                ran = true;
                return true;
            },
        });
        expect([failed, ran, existsSync(folder)]).toEqual([[], false, true]);
    });
});
