import { describe, expect, it } from 'vitest';
import { parseHostRequest } from './requests';

describe('parseHostRequest (zod at the renderer boundary)', () => {
    it('accepts every request shape', () => {
        const requests = [
            { type: 'connect', hostId: 'h1', target: { destination: 'devbox-1', installRoot: '~/.trc' } },
            {
                type: 'connect',
                hostId: 'h1',
                target: { destination: 'me@10.0.0.5', port: 2222, installRoot: '/var/tmp/trc' },
            },
            { type: 'send', hostId: 'h1', message: { type: 'listSessions', requestId: 1 } },
            { type: 'input', hostId: 'h1', stream: 1, data: new Uint8Array([3]) },
            { type: 'credit', hostId: 'h1', stream: 1, bytes: 65_536 },
            { type: 'accept-host-key', hostId: 'h1', fingerprint: 'SHA256:x' },
            { type: 'reject-host-key', hostId: 'h1' },
            { type: 'disconnect', hostId: 'h1' },
        ];
        for (const request of requests) {
            expect(parseHostRequest(request)).toEqual(request);
        }
    });

    it.each([
        ['an unknown type', { type: 'shell', hostId: 'h' }],
        [
            'a hello, which only the connection host sends',
            {
                type: 'send',
                hostId: 'h',
                message: { type: 'hello', minProto: 1, maxProto: 1, appVersion: 'x', caps: [] },
            },
        ],
        ['a reserved request id', { type: 'send', hostId: 'h', message: { type: 'ping', requestId: 0x8000_0000 } }],
        ['input that is not bytes', { type: 'input', hostId: 'h', stream: 1, data: 'rm -rf /' }],
        ['a negative credit', { type: 'credit', hostId: 'h', stream: 1, bytes: -1 }],
        ['an extra field', { type: 'disconnect', hostId: 'h', force: true }],
        ['a non-object', 'connect'],
    ])('refuses %s', (_label, value) => {
        expect(parseHostRequest(value)).toBeUndefined();
    });
});
