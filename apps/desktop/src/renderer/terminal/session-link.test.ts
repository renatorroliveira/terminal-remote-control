import type { ServerMessage, SessionInfo } from '@trc/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientRequest } from '../connection/host-client';
import { type LinkEvents, SessionLink, type SessionTransport } from './session-link';

const session: SessionInfo = {
    id: 'a1b2c3d4e5f60718',
    order: 0,
    state: 'running',
    profile: {
        id: 'login',
        name: 'bash',
        origin: 'login',
        kind: 'bash',
        path: '/bin/bash',
        args: [],
        login: true,
        env: {},
        integration: 'off',
    },
    size: { cols: 80, rows: 24 },
};

class FakeTransport implements SessionTransport {
    readonly requests: ClientRequest[] = [];
    readonly sent: string[] = [];
    readonly credits: number[] = [];
    readonly listeners = new Map<number, (data: Uint8Array) => void>();
    readonly messageListeners = new Set<(message: ServerMessage) => void>();
    /** While set, attach replies wait for it. */
    hold: Promise<void> | undefined;
    /** What the next attach reply says it replays; absent like a protocol 1 daemon's. */
    replay: 'delta' | 'snapshot' | undefined;

    request(_hostId: string, request: ClientRequest): Promise<ServerMessage> {
        this.requests.push(request);
        if (request.type === 'create') {
            return Promise.resolve({ type: 'created', requestId: 1, session });
        }
        if (request.type === 'attach') {
            const attached: ServerMessage = {
                type: 'attached',
                requestId: 2,
                session: request.session,
                stream: 7,
                credit: 1,
                ...(this.replay === undefined ? {} : { replay: this.replay }),
            };
            return (this.hold ?? Promise.resolve()).then(() => attached);
        }
        return Promise.resolve({ type: 'done', requestId: 3 });
    }

    input(_hostId: string, _stream: number, text: string): void {
        this.sent.push(text);
    }

    credit(_hostId: string, _stream: number, bytes: number): void {
        this.credits.push(bytes);
    }

    onOutput(_hostId: string, stream: number, listener: (data: Uint8Array) => void): () => void {
        this.listeners.set(stream, listener);
        return () => this.listeners.delete(stream);
    }

    onInputRefused(): () => void {
        return () => undefined;
    }

    onMessage(_hostId: string, listener: (message: ServerMessage) => void): () => void {
        this.messageListeners.add(listener);
        return () => this.messageListeners.delete(listener);
    }

    push(message: ServerMessage): void {
        for (const listener of this.messageListeners) {
            listener(message);
        }
    }

    output(bytes: number): void {
        this.listeners.get(7)?.(new Uint8Array(bytes));
    }
}

function recorder(): { readonly events: LinkEvents; readonly seen: string[] } {
    const seen: string[] = [];
    return {
        seen,
        events: {
            replay: ({ kind, endsWithSynced }) => seen.push(`replay ${kind}${endsWithSynced ? '' : ' (protocol 1)'}`),
            synced: () => seen.push('synced'),
            resync: (kind) => seen.push(`resync ${kind}`),
            peerInput: () => seen.push('peer input'),
        },
    };
}

describe('SessionLink', () => {
    it('creates a session at the terminal size and attaches its stream', async () => {
        const transport = new FakeTransport();
        const output: Uint8Array[] = [];
        const link = new SessionLink(transport, 'h1', (data) => output.push(data));
        expect(link.input('refused before attach')).toBe(false);
        link.resize({ cols: 100, rows: 30 });
        const created = await link.create({ env: {} });
        expect(created.id).toBe(session.id);
        expect(transport.requests).toEqual([
            { type: 'create', spec: { env: {}, size: { cols: 100, rows: 30 } } },
            { type: 'attach', session: session.id, mode: 'full' },
            { type: 'resize', session: session.id, size: { cols: 100, rows: 30 } },
        ]);
        transport.listeners.get(7)?.(new Uint8Array([104, 105]));
        expect(output).toEqual([new Uint8Array([104, 105])]);
        expect(link.input('ls\r')).toBe(true);
        link.credit(65_536);
        expect(transport.sent).toEqual(['ls\r']);
        expect(transport.credits).toEqual([65_536]);
    });

    it('sends size changes while attached and stops routing output once disposed', async () => {
        const transport = new FakeTransport();
        const link = new SessionLink(transport, 'h1', () => undefined);
        link.resize({ cols: 80, rows: 24 });
        await link.attach(session.id);
        link.resize({ cols: 90, rows: 24 });
        expect(transport.requests.at(-1)).toEqual({
            type: 'resize',
            session: session.id,
            size: { cols: 90, rows: 24 },
        });
        link.dispose();
        expect(transport.listeners.size).toBe(0);
        expect(transport.requests.at(-1)).toEqual({ type: 'detach', session: session.id });
    });

    it('attaches again to the same session over a new connection (US-1.14.3)', async () => {
        const transport = new FakeTransport();
        const output: Uint8Array[] = [];
        const link = new SessionLink(transport, 'h1', (data) => output.push(data));
        await link.attach(session.id);
        await link.reattach();
        expect(transport.requests.filter((request) => request.type === 'attach')).toHaveLength(2);
        expect(transport.requests.some((request) => request.type === 'detach')).toBe(false);
        transport.listeners.get(7)?.(new Uint8Array([33]));
        expect(output).toEqual([new Uint8Array([33])]);
    });
});

describe('SessionLink: disposal (US-1.14)', () => {
    it('detaches an attach that answers after the link was disposed, and routes none of its output', async () => {
        const transport = new FakeTransport();
        let release = (): void => undefined;
        transport.hold = new Promise((done) => {
            release = done;
        });
        const link = new SessionLink(transport, 'h1', () => undefined);
        const attaching = link.attach(session.id);
        link.dispose();
        release();
        await attaching;
        expect(transport.listeners.size).toBe(0);
        expect(link.attached).toBe(false);
        expect(transport.requests.at(-1)).toEqual({ type: 'detach', session: session.id });
    });
});

const synced = (offset: number): ServerMessage => ({ type: 'synced', session: session.id, stream: 7, offset });

function useFakeTimers(): void {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });
}

describe('SessionLink: protocol 2 (US-2.2.2, D-04, D-45)', () => {
    useFakeTimers();

    it('counts live output from synced and reattaches from that offset, keeping the terminal for a delta', async () => {
        const transport = new FakeTransport();
        const { events, seen } = recorder();
        const link = new SessionLink(transport, 'h1', () => undefined, events);
        transport.replay = 'snapshot';
        await link.attach(session.id);
        transport.output(50);
        transport.push(synced(1_000));
        transport.output(30);
        transport.replay = 'delta';
        await link.reattach();
        expect(transport.requests.filter((request) => request.type === 'attach').at(-1)).toEqual({
            type: 'attach',
            session: session.id,
            mode: 'full',
            fromOffset: 1_030,
        });
        expect(seen).toEqual(['replay snapshot', 'synced', 'replay delta']);
    });

    it('asks for a fresh snapshot when the daemon never said where output stands, as protocol 1', async () => {
        const transport = new FakeTransport();
        const { events, seen } = recorder();
        const link = new SessionLink(transport, 'h1', () => undefined, events);
        await link.attach(session.id);
        transport.output(10);
        await link.reattach();
        expect(transport.requests.filter((request) => request.type === 'attach').at(-1)).toEqual({
            type: 'attach',
            session: session.id,
            mode: 'full',
        });
        expect(seen).toEqual(['replay snapshot (protocol 1)', 'replay snapshot (protocol 1)']);
    });
});

describe('SessionLink: resyncs and gaps (D-04, D-45, US-2.6.4)', () => {
    useFakeTimers();

    it('starts over on a resync, and after a screen resync refreshes once output pauses', async () => {
        const transport = new FakeTransport();
        const { events, seen } = recorder();
        const link = new SessionLink(transport, 'h1', () => undefined, events);
        transport.replay = 'snapshot';
        await link.attach(session.id);
        transport.push(synced(0));
        transport.push({ type: 'resync', session: session.id, stream: 7, kind: 'screen' });
        transport.output(100);
        transport.push(synced(5_000));
        expect(link.hasGap).toBe(true);
        vi.advanceTimersByTime(500);
        transport.output(10);
        vi.advanceTimersByTime(900);
        expect(transport.requests.some((request) => request.type === 'refresh')).toBe(false);
        vi.advanceTimersByTime(200);
        expect(transport.requests.at(-1)).toEqual({ type: 'refresh', session: session.id });
        transport.push({ type: 'resync', session: session.id, stream: 7, kind: 'full' });
        transport.push(synced(5_010));
        expect(link.hasGap).toBe(false);
        expect(seen).toEqual(['replay snapshot', 'synced', 'resync screen', 'synced', 'resync full', 'synced']);
    });

    it('fills a gap at once when asked, resolving once the whole buffer is back (A11Y-03)', async () => {
        const transport = new FakeTransport();
        const link = new SessionLink(transport, 'h1', () => undefined);
        await link.attach(session.id);
        transport.push({ type: 'resync', session: session.id, stream: 7, kind: 'screen' });
        transport.push(synced(10));
        let filled = false;
        const filling = link.fillGap().then(() => {
            filled = true;
        });
        await Promise.resolve();
        expect(transport.requests.at(-1)).toEqual({ type: 'refresh', session: session.id });
        transport.push({ type: 'resync', session: session.id, stream: 7, kind: 'full' });
        await Promise.resolve();
        expect(filled).toBe(false);
        transport.push(synced(20));
        await filling;
        expect(filled).toBe(true);
    });

    it('passes on input from another client, and ignores other streams', async () => {
        const transport = new FakeTransport();
        const { events, seen } = recorder();
        const link = new SessionLink(transport, 'h1', () => undefined, events);
        transport.replay = 'snapshot';
        await link.attach(session.id);
        transport.push({ type: 'peerInput', session: session.id, stream: 9 });
        transport.push({ type: 'peerInput', session: session.id, stream: 7 });
        expect(seen).toEqual(['replay snapshot', 'peer input']);
    });
});
