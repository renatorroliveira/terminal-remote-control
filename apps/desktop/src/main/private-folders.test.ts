import { existsSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isDedicatedFolder, makeFoldersPrivate } from './private-folders';

describe('makeFoldersPrivate (SEC-05, D-68)', () => {
    const scratch = (): string => mkdtempSync(join(tmpdir(), 'trc-private-'));

    it('runs trcd.exe private-dir on each folder on Windows and reports the ones it refused', async () => {
        const root = scratch();
        const real = realpathSync(root);
        const folders = { 'trc-home': join(root, 'home'), 'app-data': join(root, 'data') };
        const calls: string[][] = [];
        const refused = await makeFoldersPrivate(folders, {
            platform: 'win32',
            trcd: 'C:\\TRC\\trcd.exe',
            profile: 'E:\\Accounts\\someone',
            run: async (program, args) => {
                calls.push([program, ...args]);
                return args[1] !== join(real, 'data');
            },
        });
        expect(calls).toEqual(
            ['home', 'data'].map((folder) => ['C:\\TRC\\trcd.exe', 'private-dir', join(real, folder)]),
        );
        expect(refused).toEqual([{ name: 'app-data', reason: 'helper-failed' }]);
        expect(Object.values(folders).every((folder) => existsSync(folder))).toBe(true);
    });

    it('leaves a folder alone on Windows that holds more than TRC, such as the profile itself', async () => {
        const profile = scratch();
        const calls: string[][] = [];
        const refused = await makeFoldersPrivate(
            { 'trc-home': profile },
            {
                platform: 'win32',
                trcd: 'C:\\TRC\\trcd.exe',
                profile,
                run: async (program, args) => {
                    calls.push([program, ...args]);
                    return true;
                },
            },
        );
        expect([refused, calls]).toEqual([[{ name: 'trc-home', reason: 'shared-folder' }], []]);
    });

    it('only creates the folders elsewhere, where their 0700 mode keeps them private', async () => {
        const folder = join(scratch(), 'home');
        let ran = false;
        const refused = await makeFoldersPrivate(
            { 'trc-home': folder },
            {
                platform: 'darwin',
                trcd: '',
                profile: '',
                run: async () => {
                    ran = true;
                    return true;
                },
            },
        );
        expect([refused, ran, existsSync(folder)]).toEqual([[], false, true]);
    });
});

describe('isDedicatedFolder: where a user-only ACL may replace what is there (SEC-05, P-94)', () => {
    const profile = 'E:\\Accounts\\someone';

    it('accepts folders inside the profile or elsewhere', () => {
        expect(isDedicatedFolder('E:\\Accounts\\someone\\.trc', profile)).toBe(true);
        expect(isDedicatedFolder('D:\\trc-home', profile)).toBe(true);
    });

    it('refuses the profile, any folder holding it and a drive root, whatever their case', () => {
        expect(isDedicatedFolder('E:\\Accounts\\someone', profile)).toBe(false);
        expect(isDedicatedFolder('e:\\accounts\\SOMEONE\\', profile)).toBe(false);
        expect(isDedicatedFolder('E:\\Accounts', profile)).toBe(false);
        expect(isDedicatedFolder('D:\\', profile)).toBe(false);
        expect(isDedicatedFolder('\\\\server\\share', profile)).toBe(false);
        expect(isDedicatedFolder('\\\\?\\E:\\Accounts\\someone', profile)).toBe(false);
        expect(isDedicatedFolder('\\\\?\\UNC\\server\\share', profile)).toBe(false);
    });

    it('accepts a folder beside the profile whose name starts with two dots', () => {
        expect(isDedicatedFolder('E:\\Accounts\\..trc', profile)).toBe(true);
    });
});
