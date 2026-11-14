import type { ServerMessage, SessionInfo } from '@trc/protocol';
import { describe, expect, it } from 'vitest';
import type { ClientRequest } from '../connection/host-client';
import { SessionLink, type SessionTransport } from './session-link';

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
    /** While set, attach replies wait for it. */
    hold: Promise<void> | undefined;

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
