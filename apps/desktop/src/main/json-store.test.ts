import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { JsonStore } from './json-store';

const schema = z.strictObject({ width: z.number().int().min(0), collapsed: z.boolean() });
const defaults = { width: 280, collapsed: false };

function fresh(): string {
    return join(mkdtempSync(join(tmpdir(), 'trc-store-')), 'state', 'ui.json');
}

describe('JsonStore (P-18)', () => {
    it('returns the defaults when nothing is stored', async () => {
        expect(await new JsonStore(fresh(), schema, defaults).read()).toEqual(defaults);
    });

    it('writes atomically to a 0600 file in a 0700 directory and reads it back', async () => {
        const file = fresh();
        const store = new JsonStore(file, schema, defaults);
        await store.write({ width: 320, collapsed: true });
        expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ width: 320, collapsed: true });
        expect(statSync(file).mode & 0o777).toBe(0o600);
        expect(statSync(join(file, '..')).mode & 0o777).toBe(0o700);
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
});
