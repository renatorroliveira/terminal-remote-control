import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClientMessageSchema } from '../src/schemas';

const FIXTURES = resolve(import.meta.dirname, '../../../protocol/fixtures/v1/client');

describe('ClientMessageSchema', () => {
    it.each(readdirSync(FIXTURES).filter((name) => name.endsWith('.json')))(
        'accepts the %s fixture unchanged',
        (name) => {
            const fixture: unknown = JSON.parse(readFileSync(resolve(FIXTURES, name), 'utf8'));
            expect(ClientMessageSchema.parse(fixture)).toEqual(fixture);
        },
    );

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
