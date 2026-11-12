import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeServerMessage, encodeClientMessage } from '../src/control';
import { FrameDecoder, FrameKind } from '../src/frame';
import type { ClientMessage } from '../src/generated/ClientMessage';

const FIXTURES = resolve(import.meta.dirname, '../../../protocol/fixtures/v1');
const fixtureNames = (dir: string): readonly string[] =>
    readdirSync(resolve(FIXTURES, dir)).filter((name) => name.endsWith('.json'));
const readFixture = (dir: string, name: string): unknown =>
    JSON.parse(readFileSync(resolve(FIXTURES, dir, name), 'utf8'));
const asPayload = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));

describe('decodeServerMessage', () => {
    it.each(fixtureNames('server'))('accepts the %s fixture unchanged', (name) => {
        const fixture = readFixture('server', name);

        expect(decodeServerMessage(asPayload(fixture))).toEqual({ ok: true, message: fixture });
    });

    it('drops unknown fields and maps unknown enum values to unspecified (NFR-12)', () => {
        const result = decodeServerMessage(asPayload({ type: 'error', code: 'quotaExceeded', message: 'x', extra: 1 }));

        expect(result).toEqual({ ok: true, message: { type: 'error', code: 'unspecified', message: 'x' } });
    });

    it('rejects unknown message types, wrong field types and invalid JSON (SEC-06)', () => {
        expect(decodeServerMessage(asPayload({ type: 'selfDestruct' })).ok).toBe(false);
        expect(decodeServerMessage(asPayload({ type: 'pong', requestId: 'one' })).ok).toBe(false);
        expect(decodeServerMessage(asPayload({ type: 'pong', requestId: -1 })).ok).toBe(false);
        expect(decodeServerMessage(new TextEncoder().encode('{not json')).ok).toBe(false);
    });
});

describe('encodeClientMessage', () => {
    it.each(fixtureNames('client'))('encodes the %s fixture as one CONTROL frame', (name) => {
        const fixture = readFixture('client', name) as ClientMessage;
        const [frame] = new FrameDecoder().push(encodeClientMessage(fixture));

        expect(frame?.kind).toBe(FrameKind.Control);
        expect(frame?.stream).toBe(0);
        expect(JSON.parse(new TextDecoder().decode(frame?.payload))).toEqual(fixture);
    });
});
