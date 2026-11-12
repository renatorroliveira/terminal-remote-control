import type { ServerMessage, SessionInfo } from '@trc/protocol';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import type { ConnectionState, ConnectTarget } from '../../shared/connection';
import type { ClientRequest } from '../connection/host-client';
import { type DevHostClient, DevHostPanel } from './DevHostPanel';

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

class FakeClient implements DevHostClient {
    readonly targets: ConnectTarget[] = [];
    readonly requests: ClientRequest[] = [];
    readonly accepted: string[] = [];
    #state: (state: ConnectionState) => void = () => undefined;

    connect(_hostId: string, target: ConnectTarget): void {
        this.targets.push(target);
    }

    acceptHostKey(_hostId: string, fingerprint: string): void {
        this.accepted.push(fingerprint);
    }

    onState(_hostId: string, listener: (state: ConnectionState) => void): () => void {
        this.#state = listener;
        return () => undefined;
    }

    emit(state: ConnectionState): void {
        this.#state(state);
    }

    request(_hostId: string, request: ClientRequest): Promise<ServerMessage> {
        this.requests.push(request);
        if (request.type === 'create') {
            return Promise.resolve({ type: 'created', requestId: 1, session });
        }
        if (request.type === 'attach') {
            return Promise.resolve({ type: 'attached', requestId: 2, session: session.id, stream: 5, credit: 1 });
        }
        return Promise.resolve({ type: 'done', requestId: 3 });
    }

    input(): void {
        return;
    }

    credit(): void {
        return;
    }

    onOutput(): () => void {
        return () => undefined;
    }
}

function requestTypes(client: FakeClient): string[] {
    return client.requests.map((request) => request.type);
}

describe('DevHostPanel (test builds only)', () => {
    it('connects a test host, then opens a terminal on a new session', async () => {
        const client = new FakeClient();
        const screen = await render(<DevHostPanel client={client} isMac assistiveTechnology={() => false} />);
        await screen.getByRole('button', { name: 'Connect' }).click();
        expect(client.targets).toEqual([{ destination: 'trc-ubuntu', installRoot: '~/.trc' }]);
        client.emit({ status: 'connecting', step: 'uploading', touch: undefined });
        await expect.element(screen.getByRole('status')).toHaveTextContent('Connecting: uploading');
        client.emit({
            status: 'host-key',
            key: { host: 'trc-ubuntu', type: 'ssh-ed25519', key: 'AAAA', fingerprint: 'SHA256:abc' },
        });
        await screen.getByRole('button', { name: 'Trust SHA256:abc' }).click();
        expect(client.accepted).toEqual(['SHA256:abc']);
        client.emit({ status: 'connected', daemon: { version: '0.1.0', sha256: 'ab', proto: 1 } });
        await expect.element(screen.getByRole('textbox', { name: 'shell, trc-ubuntu' })).toBeVisible();
        await expect.poll(() => requestTypes(client)).toEqual(['create', 'attach', 'resize']);
    });

    it('has no WCAG 2.2 A or AA violations', async () => {
        await render(<DevHostPanel client={new FakeClient()} isMac assistiveTechnology={() => false} />);
        const results = await axe.run(document.body, {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
        });
        expect(results.violations).toEqual([]);
    });
});
