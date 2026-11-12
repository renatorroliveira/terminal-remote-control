import type { ServerMessage } from '@trc/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConnectionState, HostEvent, HostRequest } from '../../shared/connection';
import { HostClient, HostRequestError } from './host-client';

interface Harness {
    readonly client: HostClient;
    readonly requests: HostRequest[];
    emit(event: HostEvent): void;
    next(): Promise<HostRequest>;
}

const channels: MessageChannel[] = [];

afterEach(() => {
    for (const channel of channels.splice(0)) {
        channel.port1.close();
        channel.port2.close();
    }
});

function harness(): Harness {
    const channel = new MessageChannel();
    channels.push(channel);
    const requests: HostRequest[] = [];
    const waiting: ((request: HostRequest) => void)[] = [];
    channel.port2.onmessage = (event: MessageEvent<HostRequest>) => {
        requests.push(event.data);
        waiting.shift()?.(event.data);
    };
    return {
        client: new HostClient(channel.port1),
        requests,
        emit: (event) => channel.port2.postMessage(event),
        next: () => new Promise((resolve) => waiting.push(resolve)),
    };
}

const connected: ConnectionState = { status: 'connected', daemon: { version: '0.1.0', sha256: 'ab', proto: 1 } };

describe('HostClient: hosts and requests', () => {
    it('connects a host and reports its states', async () => {
        const { client, emit, next } = harness();
        const states: ConnectionState[] = [];
        client.onState('h1', (state) => states.push(state));
        client.connect('h1', { destination: 'devbox-1', installRoot: '~/.trc' });
        expect(await next()).toEqual({
            type: 'connect',
            hostId: 'h1',
            target: { destination: 'devbox-1', installRoot: '~/.trc' },
        });
        emit({ type: 'state', hostId: 'h2', state: { status: 'idle' } });
        emit({ type: 'state', hostId: 'h1', state: connected });
        await expect.poll(() => states).toEqual([connected]);
    });

    it('correlates a request with its reply by request ID', async () => {
        const { client, emit, next } = harness();
        const reply = client.request('h1', { type: 'listSessions' });
        const sent = await next();
        expect(sent).toMatchObject({ type: 'send', hostId: 'h1', message: { type: 'listSessions' } });
        const requestId = sent.type === 'send' && 'requestId' in sent.message ? sent.message.requestId : -1;
        expect(requestId).toBeGreaterThan(0);
        expect(requestId).toBeLessThan(0x8000_0000);
        const answer: ServerMessage = { type: 'sessions', requestId, sessions: [] };
        emit({ type: 'message', hostId: 'h1', message: answer });
        await expect(reply).resolves.toEqual(answer);
    });

    it('rejects a request the daemon fails, and every pending request when the host drops', async () => {
        const { client, emit, next } = harness();
        const failing = client.request('h1', { type: 'close', session: 'abc' });
        const sent = await next();
        const requestId = sent.type === 'send' && 'requestId' in sent.message ? sent.message.requestId : -1;
        emit({
            type: 'message',
            hostId: 'h1',
            message: { type: 'error', requestId, code: 'unknownSession', message: 'gone' },
        });
        await expect(failing).rejects.toEqual(new HostRequestError('unknownSession', 'gone'));
        const pending = client.request('h1', { type: 'listSessions' });
        await next();
        emit({ type: 'state', hostId: 'h1', state: { status: 'disconnected', reason: 'ping-timeout' } });
        await expect(pending).rejects.toBeInstanceOf(HostRequestError);
    });
});

describe('HostClient: messages and streams', () => {
    it('delivers other daemon messages to message listeners', async () => {
        const { client, emit } = harness();
        const messages: ServerMessage[] = [];
        client.onMessage('h1', (message) => messages.push(message));
        const change: ServerMessage = { type: 'sessionEvent', change: { kind: 'closed', sessionId: 'abc' } };
        emit({ type: 'message', hostId: 'h1', message: change });
        await expect.poll(() => messages).toEqual([change]);
    });

    it('routes output by host and stream, and sends input and credit', async () => {
        const { client, emit, next } = harness();
        const output: string[] = [];
        const stop = client.onOutput('h1', 3, (data) => output.push(new TextDecoder().decode(data)));
        emit({ type: 'output', hostId: 'h1', stream: 4, data: new TextEncoder().encode('other') });
        emit({ type: 'output', hostId: 'h1', stream: 3, data: new TextEncoder().encode('mine') });
        await expect.poll(() => output).toEqual(['mine']);
        stop();
        client.input('h1', 3, 'ls\r');
        const input = await next();
        expect(input).toMatchObject({ type: 'input', hostId: 'h1', stream: 3 });
        expect(input.type === 'input' && new TextDecoder().decode(input.data)).toBe('ls\r');
        client.credit('h1', 3, 65_536);
        expect(await next()).toEqual({ type: 'credit', hostId: 'h1', stream: 3, bytes: 65_536 });
    });
});
