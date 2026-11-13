import type { ServerMessage, SessionInfo } from '@trc/protocol';
import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-react';
import type { ConnectionState, ConnectTarget } from '../../shared/connection';
import { AppProviders } from '../app/AppProviders';
import { type TerminalHost, type WorkspaceClient, WorkspaceController } from '../sessions/workspace-controller';
import { TestHostForm } from './TestHostForm';

class FakeClient implements WorkspaceClient {
    readonly targets: ConnectTarget[] = [];
    readonly trusted: string[] = [];
    state: (state: ConnectionState) => void = () => undefined;

    connect(_hostId: string, target: ConnectTarget): void {
        this.targets.push(target);
    }

    acceptHostKey(_hostId: string, fingerprint: string): void {
        this.trusted.push(fingerprint);
    }

    onState(_hostId: string, listener: (state: ConnectionState) => void): () => void {
        this.state = listener;
        return () => undefined;
    }

    onMessage(): () => void {
        return () => undefined;
    }

    request(): Promise<ServerMessage> {
        return Promise.resolve({ type: 'sessions', requestId: 1, sessions: [] });
    }
}

const terminals: TerminalHost = {
    show: () => undefined,
    create: () => Promise.reject(new Error('unused')) as Promise<SessionInfo>,
};

describe('TestHostForm (test builds only)', () => {
    it('connects a test host and trusts a host key the user confirms', async () => {
        const client = new FakeClient();
        const workspace = new WorkspaceController(client, terminals);
        const screen = await render(
            <AppProviders locale="en">
                <TestHostForm workspace={workspace} />
            </AppProviders>,
        );
        await screen.getByRole('button', { name: 'Connect' }).click();
        expect(client.targets).toEqual([{ destination: 'trc-ubuntu', installRoot: '~/.trc' }]);
        client.state({
            status: 'host-key',
            key: { host: 'trc-ubuntu', type: 'ssh-ed25519', key: 'AAAA', fingerprint: 'SHA256:abc' },
        });
        await screen.getByRole('button', { name: 'Trust SHA256:abc for trc-ubuntu' }).click();
        expect(client.trusted).toEqual(['SHA256:abc']);
        client.state({ status: 'failed', failure: { kind: 'dns', host: 'trc-ubuntu', details: 'no such host' } });
        await expect.element(screen.getByText('trc-ubuntu: dns. no such host')).toBeVisible();
    });

    it('has no WCAG 2.2 A or AA violations', async () => {
        await render(
            <AppProviders locale="en">
                <TestHostForm workspace={new WorkspaceController(new FakeClient(), terminals)} />
            </AppProviders>,
        );
        const results = await axe.run(document.body, {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
        });
        expect(results.violations).toEqual([]);
    });
});
