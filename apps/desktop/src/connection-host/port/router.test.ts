import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionState, ConnectTarget, HostEvent } from '../../shared/connection';
import type { ConnectionListener, HostConnectionLike } from './router';
import { ConnectionRouter } from './router';

class FakeConnection implements HostConnectionLike {
    readonly calls: string[] = [];
    readonly listener: ConnectionListener;
    connected = true;
    state: ConnectionState = { status: 'idle' };

    constructor(listener: ConnectionListener) {
        this.listener = listener;
    }

    async connect(): Promise<void> {
        this.calls.push('connect');
    }
    send(): boolean {
        this.calls.push('send');
        return this.connected;
    }
    input(stream: number, data: Uint8Array): boolean {
        this.calls.push(`input ${stream} ${data.length}`);
        return this.connected;
    }
    credit(stream: number, bytes: number): boolean {
        this.calls.push(`credit ${stream} ${bytes}`);
        return this.connected;
    }
    async acceptHostKey(fingerprint: string): Promise<void> {
        this.calls.push(`accept ${fingerprint}`);
    }
    rejectHostKey(): void {
        this.calls.push('reject');
    }
    checkAlive(): void {
        this.calls.push('check');
    }
    close(): void {
        this.calls.push('close');
    }

    /** Reports a state, as the real connection does through its listener. */
    report(state: ConnectionState): void {
        this.state = state;
        this.listener.state(state);
    }
}

const target: ConnectTarget = { destination: 'devbox-1', installRoot: '~/.trc' };

function setup() {
    const posted: HostEvent[] = [];
    const created: FakeConnection[] = [];
    const warnings: string[] = [];
    const router = new ConnectionRouter(
        (event) => posted.push(event),
        (_hostId, _target, listener) => {
            const connection = new FakeConnection(listener);
            created.push(connection);
            return connection;
        },
        { info: () => undefined, warn: (event) => warnings.push(event), error: () => undefined },
    );
    return { router, posted, created, warnings };
}

describe('ConnectionRouter', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('creates one connection per host and routes requests to it', () => {
        const { router, created } = setup();
        router.handle({ type: 'connect', hostId: 'h1', target });
        router.handle({ type: 'connect', hostId: 'h1', target });
        router.handle({ type: 'send', hostId: 'h1', message: { type: 'listSessions', requestId: 1 } });
        router.handle({ type: 'input', hostId: 'h1', stream: 2, data: new Uint8Array([3]) });
        router.handle({ type: 'credit', hostId: 'h1', stream: 2, bytes: 65_536 });
        router.handle({ type: 'accept-host-key', hostId: 'h1', fingerprint: 'SHA256:x' });
        router.handle({ type: 'reject-host-key', hostId: 'h1' });
        router.handle({ type: 'disconnect', hostId: 'h1' });
        expect(created).toHaveLength(1);
        expect(created[0]?.calls).toEqual([
            'connect',
            'connect',
            'send',
            'input 2 1',
            'credit 2 65536',
            'accept SHA256:x',
            'reject',
            'close',
        ]);
    });

    it('refuses input for a host that is not connected, so it is never silently lost (US-1.14)', () => {
        const { router, created, posted } = setup();
        router.handle({ type: 'input', hostId: 'nobody', stream: 1, data: new Uint8Array([1]) });
        router.handle({ type: 'connect', hostId: 'h1', target });
        if (created[0] !== undefined) {
            created[0].connected = false;
        }
        router.handle({ type: 'input', hostId: 'h1', stream: 1, data: new Uint8Array([1]) });
        router.handle({ type: 'credit', hostId: 'h1', stream: 1, bytes: 10 });
        expect(posted).toEqual([
            { type: 'refused', hostId: 'nobody', reason: 'not-connected', what: 'input' },
            { type: 'refused', hostId: 'h1', reason: 'not-connected', what: 'input' },
            { type: 'refused', hostId: 'h1', reason: 'not-connected', what: 'credit' },
        ]);
    });

    it('drops and logs malformed requests', () => {
        const { router, posted, warnings } = setup();
        router.handle({ type: 'connect', hostId: 'h1' });
        expect(posted).toEqual([]);
        expect(warnings).toEqual(['invalid request']);
    });
});

describe('ConnectionRouter events', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('posts states, messages and idle output at once, flushing batched output before control messages', () => {
        const { router, created, posted } = setup();
        router.handle({ type: 'connect', hostId: 'h1', target });
        const listener = created[0]?.listener;
        const state: ConnectionState = { status: 'connecting', step: 'checking', touch: undefined };
        listener?.state(state);
        listener?.output(1, new Uint8Array([104]));
        listener?.output(1, new Uint8Array([105]));
        listener?.message({ type: 'done', requestId: 4 });
        expect(posted).toEqual([
            { type: 'state', hostId: 'h1', state },
            { type: 'output', hostId: 'h1', stream: 1, data: new Uint8Array([104]) },
            { type: 'output', hostId: 'h1', stream: 1, data: new Uint8Array([105]) },
            { type: 'message', hostId: 'h1', message: { type: 'done', requestId: 4 } },
        ]);
    });

    it('forgets a closed connection', () => {
        const { router, created } = setup();
        router.handle({ type: 'connect', hostId: 'h1', target });
        created[0]?.listener.state({ status: 'closed' });
        router.handle({ type: 'connect', hostId: 'h1', target });
        expect(created).toHaveLength(2);
    });
});

const lost: ConnectionState = { status: 'disconnected', reason: 'channel-closed' };

function useFakeTimers(): void {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });
}

describe('ConnectionRouter reconnecting (US-2.2)', () => {
    useFakeTimers();

    it('reconnects a lost host by itself, reporting reconnecting first', () => {
        const { router, created, posted } = setup();
        router.handle({ type: 'connect', hostId: 'h1', target });
        created[0]?.report(lost);
        expect(posted.at(-1)).toMatchObject({ type: 'state', state: { status: 'reconnecting', attempt: 1 } });
        vi.advanceTimersByTime(0);
        expect(created[0]?.calls).toEqual(['connect', 'connect']);
    });

    it('reports a failed attempt only as reconnecting with its failure, so retries raise no failure', () => {
        const { router, created, posted } = setup();
        router.handle({ type: 'connect', hostId: 'h1', target });
        created[0]?.report(lost);
        vi.advanceTimersByTime(0);
        const before = posted.length;
        created[0]?.report({ status: 'failed', failure: { kind: 'timeout', host: 'h', port: 22, details: '' } });
        expect(posted.slice(before)).toEqual([
            {
                type: 'state',
                hostId: 'h1',
                state: expect.objectContaining({ status: 'reconnecting', attempt: 2, failure: expect.anything() }),
            },
        ]);
    });

    it('reports a first connection the user started that fails, and does not retry it (US-1.3)', () => {
        const { router, created, posted } = setup();
        router.handle({ type: 'connect', hostId: 'h1', target });
        created[0]?.report({ status: 'failed', failure: { kind: 'timeout', host: 'h', port: 22, details: '' } });
        expect(posted.at(-1)).toMatchObject({ type: 'state', state: { status: 'failed' } });
        vi.advanceTimersByTime(60_000);
        expect(created[0]?.calls).toEqual(['connect']);
    });

    it('retries a host the launch restores until it connects (US-2.3.3)', () => {
        const { router, created, posted } = setup();
        router.handle({ type: 'connect', hostId: 'h1', target, restore: true });
        created[0]?.report({ status: 'failed', failure: { kind: 'timeout', host: 'h', port: 22, details: '' } });
        expect(posted.at(-1)).toMatchObject({ type: 'state', state: { status: 'reconnecting', attempt: 1 } });
        vi.advanceTimersByTime(0);
        expect(created[0]?.calls).toEqual(['connect', 'connect']);
    });
});

describe('ConnectionRouter: retry now and stop retrying (US-2.2.3)', () => {
    useFakeTimers();

    it('stops reconnecting once the user disconnects', () => {
        const { router, created } = setup();
        router.handle({ type: 'connect', hostId: 'h1', target });
        router.handle({ type: 'disconnect', hostId: 'h1' });
        created[0]?.report(lost);
        vi.advanceTimersByTime(60_000);
        expect(created[0]?.calls).toEqual(['connect', 'close']);
    });

    it('retries now, or stops retrying and shows the last state again (US-2.2.3)', () => {
        const { router, created, posted } = setup();
        router.handle({ type: 'connect', hostId: 'h1', target });
        created[0]?.report(lost);
        vi.advanceTimersByTime(0);
        created[0]?.report({ status: 'failed', failure: { kind: 'timeout', host: 'h', port: 22, details: '' } });
        router.handle({ type: 'retry', hostId: 'h1' });
        expect(created[0]?.calls).toEqual(['connect', 'connect', 'connect']);
        created[0]?.report({ status: 'failed', failure: { kind: 'timeout', host: 'h', port: 22, details: '' } });
        router.handle({ type: 'stop-retrying', hostId: 'h1' });
        expect(posted.at(-1)).toMatchObject({ type: 'state', state: { status: 'failed' } });
        vi.advanceTimersByTime(60_000);
        expect(created[0]?.calls).toHaveLength(3);
    });

    it('after a wake or network change, retries waiting hosts and checks connected ones', () => {
        const { router, created } = setup();
        router.handle({ type: 'connect', hostId: 'h1', target });
        router.handle({ type: 'connect', hostId: 'h2', target });
        created[0]?.report({ status: 'connected', daemon: { version: '0.3.0', sha256: 'a', proto: 2 } });
        created[1]?.report(lost);
        vi.advanceTimersByTime(0);
        created[1]?.report({ status: 'failed', failure: { kind: 'dns', host: 'h', details: '' } });
        router.retryAll();
        expect(created[0]?.calls).toEqual(['connect', 'check']);
        expect(created[1]?.calls).toEqual(['connect', 'connect', 'connect']);
    });
});
