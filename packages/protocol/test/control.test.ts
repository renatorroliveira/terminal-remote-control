import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeServerMessage, encodeClientMessage } from '../src/control';
import { FrameDecoder, FrameKind } from '../src/frame';
import type { ClientMessage } from '../src/generated/ClientMessage';

/** The current and the previous protocol's fixtures, both of which the app must read (NFR-12). */
const VERSIONS = ['v1', 'v2', 'v3'] as const;
const FIXTURES = resolve(import.meta.dirname, '../../../protocol/fixtures');
const fixtureNames = (dir: string): readonly (readonly [string, string])[] =>
    VERSIONS.flatMap((version) =>
        readdirSync(resolve(FIXTURES, version, dir))
            .filter((name) => name.endsWith('.json'))
            .map((name) => [version, name] as const),
    );
const readFixture = (version: string, dir: string, name: string): unknown =>
    JSON.parse(readFileSync(resolve(FIXTURES, version, dir, name), 'utf8'));
const asPayload = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));

describe('decodeServerMessage', () => {
    it.each(fixtureNames('server'))('accepts the %s %s fixture unchanged', (version, name) => {
        const fixture = readFixture(version, 'server', name);

        expect(decodeServerMessage(asPayload(fixture))).toEqual({ ok: true, message: fixture });
    });

    it('drops unknown fields and maps unknown enum values to unspecified (NFR-12)', () => {
        const result = decodeServerMessage(asPayload({ type: 'error', code: 'quotaExceeded', message: 'x', extra: 1 }));

        expect(result).toEqual({ ok: true, message: { type: 'error', code: 'unspecified', message: 'x' } });
    });

    it('keeps a daemon that runs as a LaunchAgent (US-4.4.1)', () => {
        const welcome = readFixture('v3', 'server', 'welcome.json') as { readonly service: object };
        const launchd = { ...welcome, service: { ...welcome.service, manager: 'launchd' } };

        expect(decodeServerMessage(asPayload(launchd))).toEqual({ ok: true, message: launchd });
    });

    it('rejects unknown message types, wrong field types and invalid JSON (SEC-06)', () => {
        expect(decodeServerMessage(asPayload({ type: 'selfDestruct' })).ok).toBe(false);
        expect(decodeServerMessage(asPayload({ type: 'pong', requestId: 'one' })).ok).toBe(false);
        expect(decodeServerMessage(asPayload({ type: 'pong', requestId: -1 })).ok).toBe(false);
        expect(decodeServerMessage(new TextEncoder().encode('{not json')).ok).toBe(false);
    });
});

describe('encodeClientMessage', () => {
    it.each(fixtureNames('client'))('encodes the %s %s fixture as one CONTROL frame', (version, name) => {
        const fixture = readFixture(version, 'client', name) as ClientMessage;
        const [frame] = new FrameDecoder().push(encodeClientMessage(fixture));

        expect(frame?.kind).toBe(FrameKind.Control);
        expect(frame?.stream).toBe(0);
        expect(JSON.parse(new TextDecoder().decode(frame?.payload))).toEqual(fixture);
    });
});
