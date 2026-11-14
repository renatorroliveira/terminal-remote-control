import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClientMessageSchema } from '../src/schemas';

const FIXTURES = resolve(import.meta.dirname, '../../../protocol/fixtures');
const CLIENT_FIXTURES = ['v1', 'v2'].flatMap((version) =>
    readdirSync(resolve(FIXTURES, version, 'client'))
        .filter((name) => name.endsWith('.json'))
        .map((name) => [version, name] as const),
);

describe('ClientMessageSchema', () => {
    it.each(CLIENT_FIXTURES)('accepts the %s %s fixture unchanged', (version, name) => {
        const fixture: unknown = JSON.parse(readFileSync(resolve(FIXTURES, version, 'client', name), 'utf8'));
        expect(ClientMessageSchema.parse(fixture)).toEqual(fixture);
    });

    it('refuses an offset that is not a whole number of bytes', () => {
        const attach = { type: 'attach', requestId: 1, session: 's', mode: 'full', fromOffset: -1 };
        expect(ClientMessageSchema.safeParse(attach).success).toBe(false);
        expect(ClientMessageSchema.safeParse({ ...attach, fromOffset: 1.5 }).success).toBe(false);
    });

    it('rejects unknown types, unknown fields and out-of-range numbers', () => {
        expect(ClientMessageSchema.safeParse({ type: 'selfDestruct', requestId: 1 }).success).toBe(false);
        expect(ClientMessageSchema.safeParse({ type: 'ping', requestId: 1, extra: true }).success).toBe(false);
        expect(ClientMessageSchema.safeParse({ type: 'ping', requestId: -1 }).success).toBe(false);
        const resize = { type: 'resize', requestId: 1, session: 's', size: { cols: 70_000, rows: 1 } };
        expect(ClientMessageSchema.safeParse(resize).success).toBe(false);
        expect(
            ClientMessageSchema.safeParse({ type: 'attach', requestId: 1, session: 's', mode: 'sideways' }).success,
        ).toBe(false);
    });
});
