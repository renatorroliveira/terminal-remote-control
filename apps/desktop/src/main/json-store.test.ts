import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { JsonStore, replaceFile } from './json-store';

/** Windows has no POSIX modes; the user profile's ACL keeps these files private there (SEC-02, E6). */
const POSIX_MODES = process.platform !== 'win32';

const schema = z.strictObject({ width: z.number().int().min(0), collapsed: z.boolean() });
const defaults = { width: 280, collapsed: false };

function fresh(): string {
    return join(mkdtempSync(join(tmpdir(), 'trc-store-')), 'state', 'ui.json');
}

describe('replaceFile (P-95)', () => {
    const busy = Object.assign(new Error('busy'), { code: 'EBUSY' });

    it('retries while the file is in use, then succeeds', async () => {
        let calls = 0;
        const rename = async (): Promise<void> => {
            calls += 1;
            if (calls < 3) {
                throw busy;
            }
        };
        await replaceFile('a', 'b', { rename, pause: async () => undefined, platform: 'win32' });
        expect(calls).toBe(3);
    });

    it('gives up after a second, and at once on any other error', async () => {
        let calls = 0;
        const always = async (): Promise<void> => {
            calls += 1;
            throw busy;
        };
        const windows = { rename: always, pause: async () => undefined, platform: 'win32' } as const;
        await expect(replaceFile('a', 'b', windows)).rejects.toBe(busy);
        expect(calls).toBe(10);
        const missing = Object.assign(new Error('gone'), { code: 'ENOENT' });
        const gone = async (): Promise<void> => Promise.reject(missing);
        await expect(replaceFile('a', 'b', { ...windows, rename: gone })).rejects.toBe(missing);
    });

    it('fails at once elsewhere, where a refused rename is a lasting permission error', async () => {
        let calls = 0;
        const refused = async (): Promise<void> => {
            calls += 1;
            throw Object.assign(new Error('denied'), { code: 'EACCES' });
        };
        await expect(replaceFile('a', 'b', { rename: refused, platform: 'linux' })).rejects.toThrow('denied');
        expect(calls).toBe(1);
    });
});

describe('JsonStore (P-18)', () => {
    it('returns the defaults when nothing is stored', async () => {
        expect(await new JsonStore(fresh(), schema, defaults).read()).toEqual(defaults);
    });

    it('writes atomically to a 0600 file in a 0700 directory and reads it back', async () => {
        const file = fresh();
        const store = new JsonStore(file, schema, defaults);
        await store.write({ width: 320, collapsed: true });
        expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ width: 320, collapsed: true });
        if (POSIX_MODES) {
            expect(statSync(file).mode & 0o777).toBe(0o600);
            expect(statSync(join(file, '..')).mode & 0o777).toBe(0o700);
        }
        expect(await new JsonStore(file, schema, defaults).read()).toEqual({ width: 320, collapsed: true });
    });

    it('falls back to the defaults for a corrupt or invalid file', async () => {
        const file = fresh();
        const store = new JsonStore(file, schema, defaults);
        await store.write(defaults);
        writeFileSync(file, '{"width": -5, "collapsed": "yes"}');
        expect(await store.read()).toEqual(defaults);
        writeFileSync(file, '{not json');
        expect(await store.read()).toEqual(defaults);
    });

    it('refuses to write a value the schema rejects', async () => {
        const store = new JsonStore(fresh(), schema, defaults);
        await expect(store.write({ width: -1, collapsed: false })).rejects.toThrow();
    });

    it('leaves no temporary file behind when the rename fails', async () => {
        const file = fresh();
        mkdirSync(join(file, 'in-the-way'), { recursive: true });
        await expect(new JsonStore(file, schema, defaults).write(defaults)).rejects.toThrow();
        expect(readdirSync(dirname(file))).toEqual([basename(file)]);
    });
});
