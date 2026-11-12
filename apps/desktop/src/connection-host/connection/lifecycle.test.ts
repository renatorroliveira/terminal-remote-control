import { describe, expect, it } from 'vitest';
import type { ConnectionState } from '../../shared/connection';
import { type LifecycleEvent, reduceConnection } from './lifecycle';

const key = { host: 'h', type: 'ssh-ed25519', key: 'AAAA', fingerprint: 'SHA256:x' };
const daemon = { version: '0.1.0', sha256: 'a'.repeat(64), proto: 1 };
const failure = { kind: 'other', details: 'x' } as const;

function run(events: readonly LifecycleEvent[], from: ConnectionState = { status: 'idle' }): ConnectionState {
    return events.reduce(reduceConnection, from);
}

describe('reduceConnection', () => {
    it('walks the steps to connected and clears a touch request on the next step', () => {
        const touched = run([{ type: 'connect' }, { type: 'touch', text: 'Confirm user presence' }]);
        expect(touched).toEqual({ status: 'connecting', step: 'connecting', touch: 'Confirm user presence' });
        expect(run([{ type: 'step', step: 'uploading' }], touched)).toEqual({
            status: 'connecting',
            step: 'uploading',
            touch: undefined,
        });
        expect(run([{ type: 'connected', daemon }], touched)).toEqual({ status: 'connected', daemon });
    });

    it('waits for the user on an unknown host key, and connects again after acceptance', () => {
        const waiting = run([{ type: 'connect' }, { type: 'host-key', key }]);
        expect(waiting).toEqual({ status: 'host-key', key });
        expect(run([{ type: 'connect' }], waiting)).toEqual({
            status: 'connecting',
            step: 'connecting',
            touch: undefined,
        });
        expect(run([{ type: 'failed', failure }], waiting)).toEqual({ status: 'failed', failure });
    });

    it('loses a working connection and reconnects from there', () => {
        const lost = run([
            { type: 'connect' },
            { type: 'connected', daemon },
            { type: 'lost', reason: 'ping-timeout' },
        ]);
        expect(lost).toEqual({ status: 'disconnected', reason: 'ping-timeout' });
        expect(run([{ type: 'connect' }], lost).status).toBe('connecting');
        expect(run([{ type: 'connect' }], { status: 'failed', failure }).status).toBe('connecting');
    });

    it('ignores events that do not apply to the state', () => {
        const connected: ConnectionState = { status: 'connected', daemon };
        expect(
            run([{ type: 'connect' }, { type: 'step', step: 'checking' }, { type: 'host-key', key }], connected),
        ).toBe(connected);
        expect(run([{ type: 'lost', reason: 'channel-closed' }])).toEqual({ status: 'idle' });
        expect(run([{ type: 'touch', text: 'x' }], connected)).toBe(connected);
    });

    it('closes from any state, for good', () => {
        const closed = run([{ type: 'connect' }, { type: 'close' }]);
        expect(closed).toEqual({ status: 'closed' });
        expect(run([{ type: 'connect' }], closed)).toBe(closed);
    });
});
