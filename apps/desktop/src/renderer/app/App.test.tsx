import axe from 'axe-core';
import { describe, expect, it, onTestFinished } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { bashSession } from '../sessions/workspace-test-doubles';
import {
    type AppScreen,
    CONNECTED,
    CONNECTED_SAVING,
    connectedHost,
    installTokens,
    renderApp,
} from './app-test-harness';

describe('App (US-1.6.1)', () => {
    it('has a sessions sidebar and the named main region, with nothing open yet', async () => {
        await page.viewport(1400, 800);
        const screen = await renderApp().rendered;
        await expect.element(screen.getByRole('navigation', { name: 'Sessions and hosts' })).toBeVisible();
        await expect.element(screen.getByRole('main', { name: 'Terminal Remote Control' })).toBeVisible();
        await expect.element(screen.getByText('No session is open.')).toBeVisible();
        await expect.element(screen.getByText('No open sessions.')).toBeVisible();
        await expect.element(screen.getByRole('button', { name: /^New session/ })).not.toBeInTheDocument();
    });

    it('lists a connected host and its sessions, opens one, and creates new ones', async () => {
        await page.viewport(1400, 800);
        const { client, terminals, rendered } = renderApp();
        const screen = await rendered;
        await screen.getByRole('combobox', { name: 'New host' }).fill('devbox-1');
        await userEvent.keyboard('{Enter}');
        await screen.getByRole('button', { name: 'Connect devbox-1' }).click();
        expect(client.calls).toEqual(['connect host-0 devbox-1']);
        client.push('host-0', CONNECTED);
        const host = screen.getByRole('treeitem', { name: 'devbox-1, Connected' });
        await expect.element(host).toHaveAttribute('aria-expanded', 'true');
        await screen.getByRole('treeitem', { name: 'bash, Running' }).click();
        expect(terminals.shown).toEqual(['host-0/a']);
        await screen.getByRole('button', { name: 'New session on devbox-1' }).click();
        await expect.poll(() => terminals.shown).toEqual(['host-0/a', 'host-0/b']);
        await host.click();
        await expect.element(host).toHaveAttribute('aria-expanded', 'false');
        await expect.element(screen.getByRole('treeitem', { name: 'bash, Running' })).not.toBeInTheDocument();
    });

    it('moves focus to the session tree when the focused session closes, so focus is never lost (A11Y-05)', async () => {
        await page.viewport(1400, 800);
        const { client, rendered } = renderApp();
        const screen = await rendered;
        await connectedHost(screen, client);
        await screen.getByRole('treeitem', { name: 'bash, Running' }).click();
        client.message('host-0', { type: 'sessionEvent', change: { kind: 'closed', sessionId: 'a' } });
        await expect.element(screen.getByRole('treeitem', { name: 'devbox-1, Connected' })).toHaveFocus();
    });
});

describe('App: an ended session (US-1.10.9)', () => {
    it('shows why the open session ended, with Restart and Remove, until it runs again', async () => {
        await page.viewport(1400, 800);
        const exited = { ...bashSession('a'), state: 'exited', exit: { code: 1 } } as const;
        const { client, rendered } = renderApp(400, [exited]);
        const screen = await rendered;
        await connectedHost(screen, client);
        await screen.getByRole('treeitem', { name: 'bash, Exited with code 1' }).click();
        const banner = screen.getByRole('region', { name: 'Session ended' });
        await expect.poll(() => banner.element().textContent).toContain('This session ended: Exited with code 1.');
        await noViolations();
        await banner.getByRole('button', { name: 'Restart Session' }).click();
        await expect.poll(() => requestTypes(client.requests)).toContain('restart');
        await banner.getByRole('button', { name: 'Remove Session…' }).click();
        const confirm = screen.getByRole('alertdialog', { name: /^Close bash/ });
        await expect.element(confirm).toBeVisible();
        await userEvent.keyboard('{Escape}');
        client.message('host-0', {
            type: 'sessionEvent',
            change: { kind: 'updated', session: { ...bashSession('a'), state: 'running' } },
        });
        await expect.element(banner).not.toBeInTheDocument();
    });
});

describe('App: layout (US-1.6.1, A11Y-07.5)', () => {
    it('keeps the sidebar 400 px wide beside the terminal area', async () => {
        await page.viewport(1400, 800);
        const screen = await renderApp().rendered;
        const sidebar = screen
            .getByRole('navigation', { name: 'Sessions and hosts' })
            .element()
            .getBoundingClientRect();
        expect(sidebar.width).toBe(400);
        await expect.element(screen.getByRole('button', { name: 'Sessions and hosts' })).not.toBeInTheDocument();
    });

    it('collapses the sidebar into a toggled panel in a narrow window (A11Y-07.5)', async () => {
        await page.viewport(320, 640);
        const screen = await renderApp().rendered;
        const toggle = screen.getByRole('button', { name: 'Sessions and hosts' });
        await expect.element(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect.element(screen.getByRole('navigation', { name: 'Sessions and hosts' })).not.toBeInTheDocument();
        await toggle.click();
        await expect.element(toggle).toHaveAttribute('aria-expanded', 'true');
        await expect.element(screen.getByRole('navigation', { name: 'Sessions and hosts' })).toBeVisible();
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
    });
});

describe('App: sidebar splitter (US-1.6.3, A11Y-05)', () => {
    const sidebarWidth = (screen: AppScreen) =>
        screen.getByRole('navigation', { name: 'Sessions and hosts' }).element().getBoundingClientRect().width;

    it('starts at the saved width and resizes from the keyboard between 300 and 800 px, saving each width', async () => {
        await page.viewport(1400, 800);
        const { saved, rendered } = renderApp(520);
        const screen = await rendered;
        const splitter = screen.getByRole('separator', { name: 'Sidebar width' });
        await expect.element(splitter).toHaveAttribute('aria-valuenow', '520');
        await expect.element(splitter).toHaveAttribute('aria-valuemin', '300');
        await expect.element(splitter).toHaveAttribute('aria-valuemax', '800');
        expect(sidebarWidth(screen)).toBe(520);
        (splitter.element() as HTMLElement).focus();
        await userEvent.keyboard('{ArrowLeft}');
        expect(sidebarWidth(screen)).toBe(510);
        await userEvent.keyboard('{End}');
        await userEvent.keyboard('{ArrowRight}');
        await userEvent.keyboard('{Home}');
        await expect.element(splitter).toHaveAttribute('aria-valuetext', '300 pixels');
        expect(saved).toEqual([510, 800, 800, 300]);
    });

    it('follows a pointer drag of the sidebar edge, and saves where the drag ends', async () => {
        await page.viewport(1400, 800);
        const { saved, rendered } = renderApp();
        const screen = await rendered;
        const splitter = screen.getByRole('separator', { name: 'Sidebar width' }).element();
        const pointer = (type: string, clientX: number) =>
            splitter.dispatchEvent(
                new PointerEvent(type, { bubbles: true, button: 0, buttons: 1, clientX, pointerId: 1 }),
            );
        pointer('pointerdown', 400);
        pointer('pointermove', 600);
        await expect.poll(() => sidebarWidth(screen)).toBe(600);
        pointer('pointermove', 950);
        pointer('pointerup', 950);
        await expect.poll(() => sidebarWidth(screen)).toBe(800);
        expect(saved).toEqual([800]);
    });
});

describe('App: failed connections (US-1.3)', () => {
    it('shows a failed connection in a modal alert until the user presses OK (US-1.3)', async () => {
        await page.viewport(1400, 800);
        onTestFinished(installTokens());
        const { client, rendered } = renderApp();
        const screen = await rendered;
        await screen.getByRole('combobox', { name: 'New host' }).fill('devbox-1');
        await userEvent.keyboard('{Enter}');
        await screen.getByRole('button', { name: 'Connect devbox-1' }).click();
        client.push('host-0', {
            status: 'failed',
            failure: {
                kind: 'timeout',
                host: 'devbox-1',
                port: 22,
                details: 'ssh: connect to host devbox-1 port 22: Operation timed out',
            },
        });
        const alert = screen.getByRole('alertdialog', { name: 'Couldn’t connect to devbox-1' });
        await expect
            .element(alert)
            .toHaveAccessibleDescription(/didn’t answer on port 22 within 15 seconds\. .*VPN or proxy/);
        await expect
            .element(alert.getByRole('textbox', { name: 'Details' }))
            .toHaveValue('ssh: connect to host devbox-1 port 22: Operation timed out');
        await expect.element(alert.getByRole('button', { name: 'OK' })).toHaveFocus();
        const hidden = document.querySelector('nav')?.closest('[aria-hidden="true"], [inert]');
        expect(hidden?.contains(alert.element())).toBe(false);
        const results = await axe.run(document.body, {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
        });
        expect(results.violations).toEqual([]);
        await userEvent.keyboard('{Enter}');
        await expect.element(alert).not.toBeInTheDocument();
        await expect.element(screen.getByRole('button', { name: 'Retry connecting to devbox-1' })).toHaveFocus();
    });
});

describe('App: buttons (A11Y-07.1)', () => {
    it('draws Add host as a primary button (Midnight: white on dark green)', async () => {
        await page.viewport(1400, 800);
        onTestFinished(installTokens());
        const screen = await renderApp().rendered;
        const addHost = getComputedStyle(screen.getByRole('button', { name: 'Add host' }).element());
        expect([addHost.backgroundColor, addHost.color, addHost.borderColor]).toEqual([
            'rgb(0, 77, 26)',
            'rgb(255, 255, 255)',
            'rgb(0, 173, 44)',
        ]);
    });

    it('draws other buttons light on dark gray, and shows the pointer over every button', async () => {
        await page.viewport(1400, 800);
        onTestFinished(installTokens());
        const { client, rendered } = renderApp();
        const screen = await rendered;
        await connectedHost(screen, client);
        client.push('host-0', {
            status: 'host-key',
            key: { host: 'devbox-1', type: 'ssh-ed25519', key: 'AAAA', fingerprint: 'SHA256:abc' },
        });
        await expect.element(screen.getByRole('button', { name: 'Reject' })).toBeVisible();
        const reject = getComputedStyle(screen.getByRole('button', { name: 'Reject' }).element());
        expect([reject.backgroundColor, reject.color, reject.borderColor]).toEqual([
            'rgb(51, 51, 51)',
            'rgb(210, 210, 210)',
            'rgb(140, 140, 140)',
        ]);
        client.push('host-0', CONNECTED);
        await expect.element(screen.getByRole('button', { name: 'Disconnect devbox-1' })).toBeVisible();
        for (const name of ['Add host', 'Disconnect devbox-1', 'New session on devbox-1']) {
            expect(getComputedStyle(screen.getByRole('button', { name }).element()).cursor).toBe('pointer');
        }
    });

    it('has no WCAG 2.2 A or AA violations', async () => {
        await page.viewport(1400, 800);
        await renderApp().rendered;
        const results = await axe.run(document.body, {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
        });
        expect(results.violations).toEqual([]);
    });
});

async function noViolations(): Promise<void> {
    const results = await axe.run(document.body, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    });
    expect(results.violations).toEqual([]);
}

describe('App: status bar (US-1.6.1)', () => {
    it('reports the hosts, then the open session’s host and daemon, and offers the Tab, mute and notification controls', async () => {
        await page.viewport(1400, 800);
        const { client, rendered } = renderApp();
        const screen = await rendered;
        const bar = screen.getByRole('region', { name: 'Status bar' });
        await expect.poll(() => bar.element().textContent).toContain('No hosts');
        await expect.poll(() => bar.element().textContent).toContain('Daemon not reached');
        await connectedHost(screen, client);
        await expect.poll(() => bar.element().textContent).toContain('1 of 1 hosts connected');
        await screen.getByRole('treeitem', { name: 'bash, Running' }).click();
        await expect.poll(() => bar.element().textContent).toContain('devbox-1: Connected');
        await expect.poll(() => bar.element().textContent).toContain('Daemon 0.1.0');
        const tab = bar.getByRole('switch', { name: 'Tab moves focus' });
        await expect.element(tab).not.toBeChecked();
        await bar.getByText('Tab moves focus').click();
        await expect.element(tab).toBeChecked();
        await expect.element(bar.getByRole('switch', { name: 'Mute output' })).toBeEnabled();
        const notifications = bar.getByRole('button', { name: 'Notifications 0' });
        await expect.element(notifications).toBeVisible();
        expect(notifications.element().textContent).toBe('0');
        expect(notifications.element().querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    });
});

describe('App: regions and commands (A11Y-05.2, A11Y-11.11)', () => {
    it('moves focus from region to region with Command+F6 and back with Shift+Command+F6', async () => {
        await page.viewport(1400, 800);
        const screen = await renderApp().rendered;
        const field = screen.getByRole('combobox', { name: 'New host' });
        await field.click();
        await userEvent.keyboard('{Meta>}{F6}{/Meta}');
        await expect.element(screen.getByRole('main', { name: 'Terminal Remote Control' })).toHaveFocus();
        await userEvent.keyboard('{Meta>}{F6}{/Meta}');
        await expect.element(screen.getByRole('switch', { name: 'Tab moves focus' })).toHaveFocus();
        await userEvent.keyboard('{Meta>}{F6}{/Meta}');
        await expect.element(field).toHaveFocus();
        await userEvent.keyboard('{Shift>}{Meta>}{F6}{/Meta}{/Shift}');
        await expect.element(screen.getByRole('switch', { name: 'Tab moves focus' })).toHaveFocus();
    });
});

describe('App: command palette (A11Y-11.11)', () => {
    it('runs any command or host action from the palette, then returns focus (A11Y-05.8)', async () => {
        await page.viewport(1400, 800);
        onTestFinished(installTokens());
        const { client, terminals, rendered } = renderApp();
        const screen = await rendered;
        await connectedHost(screen, client);
        const field = screen.getByRole('combobox', { name: 'New host' });
        await field.click();
        await userEvent.keyboard('{Shift>}{Meta>}P{/Meta}{/Shift}');
        const palette = screen.getByRole('dialog', { name: 'Command palette' });
        await expect.element(palette.getByRole('searchbox', { name: 'Command' })).toHaveFocus();
        await expect
            .poll(() => palette.getByRole('menuitem', { name: /Next region/ }).element().textContent)
            .toContain('Cmd+F6');
        await noViolations();
        await userEvent.keyboard('new session');
        await expect.element(palette.getByRole('menuitem', { name: /Next region/ })).not.toBeInTheDocument();
        await userEvent.keyboard('{Enter}');
        await expect.element(palette).not.toBeInTheDocument();
        await expect.poll(() => terminals.shown).toEqual(['host-0/b']);
        await field.click();
        await userEvent.keyboard('{Shift>}{Meta>}P{/Meta}{/Shift}');
        await userEvent.keyboard('{Escape}');
        await expect.element(field).toHaveFocus();
    });
});

describe('App: hiding the sidebar (US-1.6.3)', () => {
    it('hides the sidebar with Control+Command+S and shows it again from the splitter with Enter', async () => {
        await page.viewport(1400, 800);
        const { saved, rendered } = renderApp();
        const screen = await rendered;
        await screen.getByRole('combobox', { name: 'New host' }).click();
        await userEvent.keyboard('{Control>}{Meta>}S{/Meta}{/Control}');
        await expect.element(screen.getByRole('navigation', { name: 'Sessions and hosts' })).not.toBeInTheDocument();
        await expect.element(screen.getByRole('main', { name: 'Terminal Remote Control' })).toHaveFocus();
        const splitter = screen.getByRole('separator', { name: 'Sidebar width' });
        await expect.element(splitter).toHaveAttribute('aria-valuetext', 'Sidebar hidden');
        (splitter.element() as HTMLElement).focus();
        await userEvent.keyboard('{Enter}');
        await expect.element(screen.getByRole('navigation', { name: 'Sessions and hosts' })).toBeVisible();
        expect(saved).toEqual([true, false]);
    });
});

describe('App: notifications and context menus (A11Y-11.11, A11Y-12)', () => {
    it('keeps a failed connection in the notification list until it is dismissed', async () => {
        await page.viewport(1400, 800);
        onTestFinished(installTokens());
        const { client, workspace, rendered } = renderApp();
        const screen = await rendered;
        await screen.getByRole('combobox', { name: 'New host' }).fill('devbox-1');
        await userEvent.keyboard('{Enter}');
        workspace.connectAll();
        client.push('host-0', { status: 'failed', failure: { kind: 'dns', host: 'devbox-1', details: '' } });
        await screen.getByRole('button', { name: 'Notifications 1' }).click();
        const list = screen.getByRole('dialog', { name: 'Notifications' });
        await expect
            .poll(() => list.element().textContent)
            .toContain('Couldn’t connect to devbox-1. devbox-1 couldn’t be found.');
        await noViolations();
        await list.getByRole('button', { name: /^Dismiss: Couldn’t connect/ }).click();
        await expect.poll(() => list.element().textContent).toContain('No notifications.');
        await userEvent.keyboard('{Escape}');
        await expect.element(screen.getByRole('button', { name: 'Notifications 0' })).toHaveFocus();
    });

    it('opens a host’s and a session’s actions with Shift+F10, and Escape returns focus', async () => {
        await page.viewport(1400, 800);
        const { client, rendered } = renderApp();
        const screen = await rendered;
        await connectedHost(screen, client);
        const option = screen.getByRole('treeitem', { name: 'bash, Running' });
        (option.element() as HTMLElement).focus();
        await userEvent.keyboard('{Shift>}{F10}{/Shift}');
        const menu = screen.getByRole('menu', { name: 'Actions for bash' });
        await expect.element(menu.getByRole('menuitem', { name: 'Open' })).toHaveFocus();
        await userEvent.keyboard('{Escape}');
        await expect.element(option).toHaveFocus();
        (screen.getByRole('treeitem', { name: 'devbox-1, Connected' }).element() as HTMLElement).focus();
        await userEvent.keyboard('{Shift>}{F10}{/Shift}');
        const hostMenu = screen.getByRole('menu', { name: 'Actions for devbox-1' });
        await expect.element(hostMenu.getByRole('menuitem', { name: 'New session on devbox-1' })).toHaveFocus();
        await expect.element(hostMenu.getByRole('menuitem', { name: 'Disconnect devbox-1' })).toBeVisible();
        await userEvent.keyboard('{Escape}');
    });
});

describe('App: host key dialog (US-1.2.1)', () => {
    it('asks with the copyable fingerprint and no time limit; Trust accepts, Escape rejects', async () => {
        await page.viewport(1400, 800);
        onTestFinished(installTokens());
        const { client, rendered } = renderApp();
        const screen = await rendered;
        await screen.getByRole('combobox', { name: 'New host' }).fill('devbox-1');
        await userEvent.keyboard('{Enter}');
        const hostKey = {
            status: 'host-key',
            key: { host: 'devbox-1', type: 'ssh-ed25519', key: 'AAAA', fingerprint: 'SHA256:abc' },
        } as const;
        client.push('host-0', hostKey);
        const dialog = screen.getByRole('alertdialog', { name: 'Trust the host key of devbox-1?' });
        const fingerprint = dialog.getByRole('textbox', { name: 'SHA-256 fingerprint' });
        await expect.element(fingerprint).toHaveValue('SHA256:abc');
        await expect.element(fingerprint).toHaveAttribute('readonly');
        await expect.element(fingerprint).toHaveFocus();
        await noViolations();
        await dialog.getByRole('button', { name: 'Trust' }).click();
        expect(client.calls).toContain('accept host-0 SHA256:abc');
        client.push('host-0', { status: 'connecting', step: 'connecting', touch: undefined });
        client.push('host-0', hostKey);
        await expect.element(dialog).toBeVisible();
        await userEvent.keyboard('{Escape}');
        expect(client.calls).toContain('reject host-0');
    });
});

/** The types of the requests a fake client received, in order. */
function requestTypes(requests: readonly { readonly type: string }[]): readonly string[] {
    return requests.map((request) => request.type);
}

/** Opens the host row's context menu and chooses `item`. */
async function hostMenu(screen: AppScreen, item: string) {
    const row = screen.getByRole('list', { name: 'Known hosts' }).getByRole('button', { name: /devbox-1/ });
    (row.element() as HTMLElement).focus();
    await userEvent.keyboard('{Shift>}{F10}{/Shift}');
    await screen.getByRole('menuitem', { name: item }).click();
}

describe('App: forgetting and moving hosts (A11Y-11.9, US-1.4.3, US-1.1.5)', () => {
    it('forgets a host only after a confirmation that names what it removes', async () => {
        await page.viewport(1400, 800);
        onTestFinished(installTokens());
        const { rendered } = renderApp();
        const screen = await rendered;
        await screen.getByRole('combobox', { name: 'New host' }).fill('devbox-1');
        await userEvent.keyboard('{Enter}');
        await hostMenu(screen, 'Forget devbox-1…');
        const confirm = screen.getByRole('alertdialog', { name: 'Forget devbox-1?' });
        await expect.poll(() => confirm.element().textContent).toContain('sessions keep running on the host');
        await expect.element(confirm.getByRole('button', { name: 'Cancel' })).toHaveFocus();
        await noViolations();
        await confirm.getByRole('button', { name: 'Forget and leave sessions running' }).click();
        await expect.element(screen.getByText('No hosts yet.')).toBeVisible();
        await expect.element(screen.getByRole('combobox', { name: 'New host' })).toHaveFocus();
    });

    it('stops the sessions, removes the daemon and forgets the host, as the user chooses (US-3.3.4)', async () => {
        await page.viewport(1400, 800);
        const { client, rendered } = renderApp();
        const screen = await rendered;
        await connectedHost(screen, client);
        await hostMenu(screen, 'Forget devbox-1…');
        const confirm = screen.getByRole('alertdialog', { name: 'Forget devbox-1?' });
        await confirm.getByRole('button', { name: 'Stop sessions, remove the daemon and forget' }).click();
        await expect.poll(() => client.calls).toContain('remove-daemon host-0');
        await expect.element(screen.getByText('No hosts yet.')).toBeVisible();
    });

    it('keeps a host whose daemon could not be removed, and says why (US-3.3.4)', async () => {
        await page.viewport(1400, 800);
        const { client, spoken, rendered } = renderApp();
        const screen = await rendered;
        await connectedHost(screen, client);
        client.removal = { kind: 'failed', failure: { kind: 'no-answer', details: '' } };
        await hostMenu(screen, 'Forget devbox-1…');
        await screen.getByRole('button', { name: 'Stop sessions, remove the daemon and forget' }).click();
        await expect.poll(() => spoken.join('\n')).toContain('Couldn’t remove the daemon from devbox-1.');
        await expect.element(screen.getByRole('button', { name: 'Connect devbox-1' })).toBeVisible();
    });

    it('moves the install location, refusing a relative path', async () => {
        await page.viewport(1400, 800);
        const { client, workspace, rendered } = renderApp();
        const screen = await rendered;
        await screen.getByRole('combobox', { name: 'New host' }).fill('devbox-1');
        await userEvent.keyboard('{Enter}');
        await hostMenu(screen, 'Change install location of devbox-1…');
        const field = screen.getByRole('textbox', { name: 'Install location' });
        await expect.element(field).toHaveValue('~/.trc');
        await field.fill('scratch/trc');
        await userEvent.keyboard('{Enter}');
        await expect.element(screen.getByText('Type a path that starts with / or ~/.')).toBeVisible();
        await field.fill('/scratch/trc');
        await userEvent.keyboard('{Enter}');
        await expect.element(field).not.toBeInTheDocument();
        workspace.toggleConnection('host-0');
        expect(client.calls.at(-1)).toBe('connect host-0 devbox-1');
        expect(workspace.store.getState().hosts[0]?.installRoot).toBe('/scratch/trc');
    });

    it('tests a connection and says it works', async () => {
        await page.viewport(1400, 800);
        const { client, spoken, rendered } = renderApp();
        const screen = await rendered;
        await screen.getByRole('combobox', { name: 'New host' }).fill('devbox-1');
        await userEvent.keyboard('{Enter}');
        await hostMenu(screen, 'Test connection to devbox-1');
        await expect.poll(() => client.calls).toContain('connect host-0 devbox-1');
        client.push('host-0', CONNECTED);
        await expect.poll(() => spoken).toContain('The connection to devbox-1 works.');
        expect(client.calls).toContain('disconnect host-0');
    });
});

describe('App: a host’s daemon (US-3.3.1 to US-3.3.3)', () => {
    const details = {
        home: '/home/me',
        installRoot: '/home/me/.trc',
        logDir: '/home/me/.trc/logs',
        startedAt: Date.now() - 2 * 86_400_000 - 3 * 3_600_000,
    };
    const daemon = {
        version: '0.4.0',
        sha256: 'ab',
        proto: 3,
        service: { manager: 'detached', sessionsEndAtLogout: false },
        details,
        bundled: '0.4.0',
    } as const;

    it('shows the daemon’s details with copyable locations, and restarts it', async () => {
        await page.viewport(1400, 800);
        onTestFinished(installTokens());
        const { client, rendered } = renderApp();
        const screen = await rendered;
        await connectedHost(screen, client, { status: 'connected', daemon });
        await hostMenu(screen, 'Details of devbox-1…');
        const dialog = screen.getByRole('dialog', { name: 'Details of devbox-1' });
        await expect.poll(() => dialog.element().textContent).toContain('0.4.0');
        expect(dialog.element().textContent).toContain('2 days, 3 hours');
        expect(dialog.element().textContent).toContain('On its own, outside any service manager');
        await expect.element(dialog.getByRole('textbox', { name: 'Install location' })).toHaveValue('/home/me/.trc');
        await expect.element(dialog.getByRole('textbox', { name: 'Logs' })).toHaveValue('/home/me/.trc/logs');
        await expect.element(dialog.getByRole('button', { name: 'Upgrade daemon' })).not.toBeInTheDocument();
        expect(dialog.element().textContent).toContain('Up to date');
        await noViolations();
        await dialog.getByRole('button', { name: 'Restart daemon' }).click();
        await expect.poll(() => client.requests).toContainEqual({ type: 'restartDaemon' });
    });

    it('says in the details when the daemon cannot save some sessions’ scrollback (US-3.1.2)', async () => {
        await page.viewport(1400, 800);
        const failing = { ...bashSession('a'), persistenceFailure: 'diskFull' } as const;
        const { client, rendered } = renderApp(400, [failing]);
        const screen = await rendered;
        await connectedHost(screen, client, { status: 'connected', daemon });
        await hostMenu(screen, 'Details of devbox-1…');
        const dialog = screen.getByRole('dialog', { name: 'Details of devbox-1' });
        await expect.poll(() => dialog.element().textContent).toContain('Fails for 1 session: the disk is full');
    });

    it('offers Upgrade daemon when the host runs an older daemon than the app brings', async () => {
        await page.viewport(1400, 800);
        const { client, rendered } = renderApp();
        const screen = await rendered;
        await connectedHost(screen, client, { status: 'connected', daemon: { ...daemon, version: '0.3.0' } });
        await hostMenu(screen, 'Details of devbox-1…');
        const dialog = screen.getByRole('dialog', { name: 'Details of devbox-1' });
        expect(dialog.element().textContent).not.toContain('Up to date');
        await dialog.getByRole('button', { name: 'Upgrade daemon' }).click();
        await expect.poll(() => client.calls).toContain('disconnect host-0');
        expect(client.calls.at(-1)).toBe('connect host-0 devbox-1');
    });

    it('removes the daemon after a confirmation that lists the sessions that stop and the data deleted', async () => {
        await page.viewport(1400, 800);
        onTestFinished(installTokens());
        const { client, rendered } = renderApp();
        const screen = await rendered;
        await connectedHost(screen, client, { status: 'connected', daemon });
        await hostMenu(screen, 'Details of devbox-1…');
        await screen.getByRole('button', { name: 'Remove daemon from host…' }).click();
        const confirm = screen.getByRole('alertdialog', { name: 'Remove the daemon from devbox-1?' });
        await expect.poll(() => confirm.element().textContent).toContain('This session stops:');
        expect(
            confirm
                .getByRole('listitem')
                .elements()
                .map((item) => item.textContent),
        ).toEqual(['bash']);
        expect(confirm.element().textContent).toContain('logs from ~/.trc on devbox-1');
        await expect.element(confirm.getByRole('button', { name: 'Cancel' })).toHaveFocus();
        await noViolations();
        await confirm.getByRole('button', { name: 'Remove daemon' }).click();
        await expect.poll(() => client.calls).toContain('remove-daemon host-0');
        await expect
            .element(screen.getByRole('button', { name: 'Connect devbox-1' }))
            .toHaveAccessibleDescription('Daemon removed');
    });
});

describe('App: reconnecting hosts (US-2.2)', () => {
    it('shows a lost host Reconnecting, and retries it now or stops it retrying (US-2.2.2, US-2.2.3)', async () => {
        await page.viewport(1400, 800);
        const { client, rendered } = renderApp();
        const screen = await rendered;
        await connectedHost(screen, client);
        client.push('host-0', { status: 'disconnected', reason: 'ping-timeout' });
        client.push('host-0', { status: 'reconnecting', attempt: 2, nextAttemptAt: 0, failure: undefined });
        await expect.element(screen.getByRole('treeitem', { name: 'bash, Reconnecting' })).toBeInTheDocument();
        await screen.getByRole('button', { name: 'Reconnect devbox-1 now' }).click();
        expect(client.calls.at(-1)).toBe('retry host-0');
        await hostMenu(screen, 'Stop reconnecting to devbox-1');
        expect(client.calls.at(-1)).toBe('stop-retrying host-0');
    });
});

describe('App: managing sessions (US-1.10)', () => {
    async function sessionMenu(screen: AppScreen, item: string) {
        (screen.getByRole('treeitem', { name: 'bash, Running' }).element() as HTMLElement).focus();
        await userEvent.keyboard('{Shift>}{F10}{/Shift}');
        await screen.getByRole('menuitem', { name: item }).click();
    }

    it('renames a session, and an empty name gives the program’s title back (US-1.10.1)', async () => {
        await page.viewport(1400, 800);
        const { client, rendered } = renderApp();
        const screen = await rendered;
        await connectedHost(screen, client);
        await sessionMenu(screen, 'Rename…');
        const field = screen.getByRole('dialog', { name: 'Rename bash' }).getByRole('textbox', { name: 'Name' });
        await expect.element(field).toHaveFocus();
        await field.fill('logs');
        await userEvent.keyboard('{Enter}');
        await expect.poll(() => client.requests).toContainEqual({ type: 'rename', session: 'a', name: 'logs' });
    });

    it('closes a session only after a confirmation that names what it deletes (US-1.10.4)', async () => {
        await page.viewport(1400, 800);
        onTestFinished(installTokens());
        const { client, rendered } = renderApp();
        const screen = await rendered;
        await connectedHost(screen, client);
        await sessionMenu(screen, 'Close…');
        const confirm = screen.getByRole('alertdialog', { name: 'Close bash?' });
        await expect.poll(() => confirm.element().textContent).toContain('deletes the session and its scrollback');
        await expect.element(confirm.getByRole('button', { name: 'Cancel' })).toHaveFocus();
        await noViolations();
        await confirm.getByRole('button', { name: 'Close session' }).click();
        await expect.poll(() => client.requests).toContainEqual({ type: 'close', session: 'a' });
    });

    it('stops, restarts and duplicates a session from its menu (US-1.10.2, US-1.10.3, US-1.10.5)', async () => {
        await page.viewport(1400, 800);
        const { client, terminals, rendered } = renderApp();
        const screen = await rendered;
        await connectedHost(screen, client);
        await sessionMenu(screen, 'Stop');
        await sessionMenu(screen, 'Restart');
        await sessionMenu(screen, 'Duplicate');
        await expect
            .poll(() => client.requests)
            .toEqual([
                { type: 'stop', session: 'a' },
                { type: 'restart', session: 'a' },
            ]);
        await expect.poll(() => terminals.options.at(-1)).toEqual({ profileId: 'login' });
    });
});

describe('App: creating and switching sessions (US-1.7, US-1.8.2)', () => {
    it('creates a session with Command+T and moves between sessions with Shift+Command+] and [', async () => {
        await page.viewport(1400, 800);
        const { client, terminals, rendered } = renderApp();
        const screen = await rendered;
        await connectedHost(screen, client);
        await screen.getByRole('combobox', { name: 'New host' }).click();
        await userEvent.keyboard('{Meta>}t{/Meta}');
        await expect.poll(() => terminals.shown).toEqual(['host-0/b']);
        await userEvent.keyboard('{Shift>}{Meta>}]{/Meta}{/Shift}');
        await userEvent.keyboard('{Shift>}{Meta>}[[{/Meta}{/Shift}');
        expect(terminals.shown).toEqual(['host-0/b', 'host-0/a', 'host-0/b']);
    });

    it('creates a session with a chosen shell, folder, name and environment (US-1.7.2)', async () => {
        await page.viewport(1400, 800);
        onTestFinished(installTokens());
        const { client, terminals, rendered } = renderApp();
        const screen = await rendered;
        await connectedHost(screen, client);
        await screen.getByRole('combobox', { name: 'New host' }).click();
        await userEvent.keyboard('{Shift>}{Meta>}t{/Meta}{/Shift}');
        const dialog = screen.getByRole('dialog', { name: 'New session' });
        await dialog.getByRole('button', { name: /Shell/ }).click();
        await screen.getByRole('option', { name: 'zsh' }).click();
        await dialog.getByRole('textbox', { name: 'Working folder (optional)' }).fill('/srv/app');
        await dialog.getByRole('textbox', { name: 'Name (optional)' }).fill('deploy');
        await dialog.getByRole('textbox', { name: 'Environment (optional)' }).fill('not a variable');
        await dialog.getByRole('button', { name: 'Create' }).click();
        await expect.element(dialog.getByText(/Write each line as NAME=value/)).toBeVisible();
        await noViolations();
        await dialog.getByRole('textbox', { name: 'Environment (optional)' }).fill('EDITOR=vim\nOLD=');
        await dialog.getByRole('button', { name: 'Create' }).click();
        await expect
            .poll(() => terminals.options.at(-1))
            .toEqual({ profileId: 'zsh', cwd: '/srv/app', name: 'deploy', env: { EDITOR: 'vim', OLD: null } });
        await expect.element(dialog.getByRole('switch', { name: 'Restore after restart' })).not.toBeInTheDocument();
    });

    it('creates a session that saves no scrollback on a daemon that saves it (US-3.2.2)', async () => {
        await page.viewport(1400, 800);
        onTestFinished(installTokens());
        const { client, terminals, rendered } = renderApp();
        const screen = await rendered;
        await connectedHost(screen, client, CONNECTED_SAVING);
        await screen.getByRole('combobox', { name: 'New host' }).click();
        await userEvent.keyboard('{Shift>}{Meta>}t{/Meta}{/Shift}');
        const dialog = screen.getByRole('dialog', { name: 'New session' });
        await expect.element(dialog.getByRole('switch', { name: 'Restore after restart' })).toBeChecked();
        await dialog.getByText('Save scrollback to disk', { exact: true }).click();
        await noViolations();
        await dialog.getByRole('button', { name: 'Create' }).click();
        await expect
            .poll(() => terminals.options.at(-1))
            .toEqual({ profileId: 'login', env: {}, options: { restore: true, saveScrollback: false } });
    });
});

describe('App: Session settings (US-3.2.1, US-3.2.2)', () => {
    it('sets what a session restores and saves, from its context menu', async () => {
        await page.viewport(1400, 800);
        onTestFinished(installTokens());
        const saving = { ...bashSession('a'), options: { restore: true, saveScrollback: true } };
        const { client, rendered } = renderApp(400, [saving]);
        const screen = await rendered;
        await connectedHost(screen, client, CONNECTED_SAVING);
        (screen.getByRole('treeitem', { name: 'bash, Running' }).element() as HTMLElement).focus();
        await userEvent.keyboard('{Shift>}{F10}{/Shift}');
        await screen.getByRole('menuitem', { name: 'Session settings…' }).click();
        const dialog = screen.getByRole('dialog', { name: 'Settings for bash' });
        const restore = dialog.getByRole('switch', { name: 'Restore after restart' });
        await expect.element(restore).toHaveFocus();
        await expect.element(dialog.getByRole('switch', { name: 'Save scrollback to disk' })).toBeChecked();
        await noViolations();
        await userEvent.keyboard(' ');
        await dialog.getByRole('button', { name: 'Save' }).click();
        await expect
            .poll(() => client.requests)
            .toContainEqual({
                type: 'setSessionOptions',
                session: 'a',
                options: { restore: false, saveScrollback: true },
            });
    });
});
