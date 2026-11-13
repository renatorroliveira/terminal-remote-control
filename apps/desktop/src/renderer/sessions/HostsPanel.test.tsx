import axe from 'axe-core';
import { describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import type { KnownHost } from '../../shared/hosts';
import { AppProviders } from '../app/AppProviders';
import { HostsPanel } from './HostsPanel';
import { type KnownHostStore, WorkspaceController } from './workspace-controller';
import { FakeKnownHostStore, FakeTerminalHost, FakeWorkspaceClient } from './workspace-test-doubles';

async function renderPanel(hosts: KnownHostStore = new FakeKnownHostStore()) {
    const client = new FakeWorkspaceClient();
    const workspace = new WorkspaceController(client, new FakeTerminalHost(), hosts);
    const screen = await render(
        <AppProviders locale="en">
            <HostsPanel workspace={workspace} />
        </AppProviders>,
    );
    return { client, workspace, screen };
}

/** A store whose adds wait until the test lets them finish. */
class SlowKnownHostStore implements KnownHostStore {
    readonly #hosts = new FakeKnownHostStore();
    readonly #waiting: (() => void)[] = [];

    list(): Promise<readonly KnownHost[]> {
        return this.#hosts.list();
    }

    add(address: string): Promise<KnownHost> {
        return new Promise((resolve, reject) => {
            this.#waiting.push(() => void this.#hosts.add(address).then(resolve, reject));
        });
    }

    suggestions(): Promise<readonly string[]> {
        return this.#hosts.suggestions();
    }

    remove(id: string): Promise<void> {
        return this.#hosts.remove(id);
    }

    setInstallRoot(id: string, installRoot: string): Promise<KnownHost> {
        return this.#hosts.setInstallRoot(id, installRoot);
    }

    finish(): void {
        for (const done of this.#waiting.splice(0)) {
            done();
        }
    }
}

describe('HostsPanel (US-1.1.1, US-1.2, US-1.5)', () => {
    it('adds a typed host, and refuses an address ssh could not use', async () => {
        const { screen } = await renderPanel();
        await expect.element(screen.getByText('No hosts yet.')).toBeVisible();
        await screen.getByRole('combobox', { name: 'New host' }).fill('two words');
        await screen.getByRole('button', { name: 'Add host' }).click();
        await expect
            .element(screen.getByText('Not a host address. Type an SSH alias, or user@host:port.'))
            .toBeVisible();
        await screen.getByRole('combobox', { name: 'New host' }).fill('me@build:2222');
        await userEvent.keyboard('{Enter}');
        await expect
            .element(
                screen
                    .getByRole('list', { name: 'Known hosts' })
                    .getByRole('button', { name: 'Connect me@build:2222' }),
            )
            .toBeVisible();
        await expect.element(screen.getByRole('combobox', { name: 'New host' })).toHaveValue('');
    });

    it('puts Add host to the right of the field, on its row, with an optional user field below (US-1.1.6)', async () => {
        const { screen } = await renderPanel();
        const field = screen.getByRole('combobox', { name: 'New host' }).element().getBoundingClientRect();
        const button = screen.getByRole('button', { name: 'Add host' }).element().getBoundingClientRect();
        expect(button.left).toBeGreaterThanOrEqual(field.right);
        expect(Math.abs(button.top + button.height / 2 - (field.top + field.height / 2))).toBeLessThan(2);
        const user = screen.getByRole('textbox', { name: 'User (optional)' });
        await expect.element(user).toHaveAttribute('autocomplete', 'username');
        expect(user.element().getBoundingClientRect().top).toBeGreaterThan(field.bottom);
    });
});

describe('HostsPanel: the add-host form (US-1.1.1, US-1.1.6)', () => {
    it('joins the user field and the host, and refuses a user given twice', async () => {
        const { screen } = await renderPanel();
        await screen.getByRole('combobox', { name: 'New host' }).fill('me@build');
        await screen.getByRole('textbox', { name: 'User (optional)' }).fill('ops');
        await screen.getByRole('button', { name: 'Add host' }).click();
        await expect
            .element(screen.getByText('Give the user either in the host field or here, not both.'))
            .toBeVisible();
        await screen.getByRole('combobox', { name: 'New host' }).fill('build:2222');
        await screen.getByRole('button', { name: 'Add host' }).click();
        await expect.element(screen.getByRole('button', { name: 'Connect ops@build:2222' })).toBeVisible();
        await expect.element(screen.getByRole('textbox', { name: 'User (optional)' })).toHaveValue('');
    });

    it('offers recent hosts and SSH config hosts as the user types (US-1.1.1)', async () => {
        const hosts = new FakeKnownHostStore();
        hosts.suggested = ['devbox-1', 'build.example.com'];
        const { screen } = await renderPanel(hosts);
        await screen.getByRole('combobox', { name: 'New host' }).fill('dev');
        await screen.getByRole('option', { name: 'devbox-1' }).click();
        await expect.element(screen.getByRole('combobox', { name: 'New host' })).toHaveValue('devbox-1');
        await expect.element(screen.getByRole('option', { name: 'build.example.com' })).not.toBeInTheDocument();
    });

    it('keeps what the user typed while an earlier add was still saving', async () => {
        const hosts = new SlowKnownHostStore();
        const { screen } = await renderPanel(hosts);
        const field = screen.getByRole('combobox', { name: 'New host' });
        await field.fill('devbox-1');
        await screen.getByRole('button', { name: 'Add host' }).click();
        await field.fill('devbox-2');
        hosts.finish();
        await expect.element(screen.getByRole('button', { name: 'Connect devbox-1' })).toBeVisible();
        await new Promise((settled) => setTimeout(settled, 50));
        expect((field.element() as HTMLInputElement).value).toBe('devbox-2');
    });
});

describe('HostsPanel: connection badges (US-1.2, US-1.5)', () => {
    it('names each badge by what it does, describes the state, and connects or disconnects on press', async () => {
        const { client, workspace, screen } = await renderPanel();
        const host = await workspace.addHost('devbox-1');
        const connect = screen.getByRole('button', { name: 'Connect devbox-1' });
        await expect.element(connect).toHaveAccessibleDescription('Not connected');
        await connect.click();
        client.push(host.id, { status: 'connecting', step: 'uploading', touch: undefined });
        await expect
            .element(screen.getByRole('button', { name: 'Cancel connecting to devbox-1' }))
            .toHaveAccessibleDescription('Uploading the daemon');
        client.push(host.id, { status: 'connected', daemon: { version: '0.1.0', sha256: 'ab', proto: 1 } });
        const disconnect = screen.getByRole('button', { name: 'Disconnect devbox-1' });
        await expect.element(disconnect).toHaveAccessibleDescription('Connected');
        await disconnect.click();
        expect(client.calls).toEqual([`connect ${host.id} devbox-1`, `disconnect ${host.id}`]);
    });

    it('names the badge of a host whose key waits for the user', async () => {
        const { client, workspace, screen } = await renderPanel();
        const host = await workspace.addHost('devbox-1');
        client.push(host.id, {
            status: 'host-key',
            key: { host: 'devbox-1', type: 'ssh-ed25519', key: 'AAAA', fingerprint: 'SHA256:abc' },
        });
        await expect
            .element(screen.getByRole('button', { name: 'Review the host key of devbox-1' }))
            .toHaveAccessibleDescription('Host key needs confirmation');
    });
});

describe('HostsPanel: failures and accessibility (US-1.3)', () => {
    it('describes a failed host with what went wrong', async () => {
        const { client, workspace, screen } = await renderPanel();
        const host = await workspace.addHost('devbox-1');
        client.push(host.id, {
            status: 'failed',
            failure: { kind: 'dns', host: 'devbox-1', details: 'no such host' },
        });
        await expect
            .element(screen.getByRole('button', { name: 'Connect devbox-1' }))
            .toHaveAccessibleDescription('Connection failed: no such host');
    });

    it('has no WCAG 2.2 A or AA violations', async () => {
        const { workspace } = await renderPanel();
        await workspace.addHost('devbox-1');
        const results = await axe.run(document.body, {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
        });
        expect(results.violations).toEqual([]);
    });
});
