import { createIntl } from 'react-intl';
import { describe, expect, it, onTestFinished } from 'vitest';
import { resolveKeymap } from '../../shared/keymap';
import { messagesFor } from '../i18n/locale';
import { WorkspaceController } from '../sessions/workspace-controller';
import {
    bashSession,
    FakeKnownHostStore,
    FakeTerminalHost,
    FakeWorkspaceClient,
} from '../sessions/workspace-test-doubles';
import type { AnnounceOptions } from './announcer';
import { NotificationCenter } from './notifications';
import { Shell } from './shell';

const CONNECTED = { status: 'connected', daemon: { version: '0.2.0', sha256: 'ab', proto: 1 } } as const;

async function setup(narrow = false) {
    const client = new FakeWorkspaceClient([bashSession('a')]);
    const terminals = new FakeTerminalHost([]);
    const workspace = new WorkspaceController(client, terminals, new FakeKnownHostStore());
    const spoken: string[] = [];
    const saved: boolean[] = [];
    const shell = new Shell({
        workspace,
        terminals,
        sidebar: {
            width: () => Promise.resolve(400),
            setWidth: () => Promise.resolve(),
            collapsed: () => Promise.resolve(false),
            setCollapsed: (collapsed) => {
                saved.push(collapsed);
                return Promise.resolve();
            },
        },
        announcer: {
            announce: (text: string, options?: AnnounceOptions) =>
                spoken.push(options?.politeness === 'assertive' ? `! ${text}` : text),
        },
        notifications: new NotificationCenter(() => 0),
        keymap: resolveKeymap({}),
        intl: createIntl({ locale: 'en', messages: messagesFor('en') }),
        document,
        isNarrow: () => narrow,
    });
    onTestFinished(shell.start());
    await workspace.addHost('devbox-1');
    return { client, terminals, workspace, shell, spoken, saved };
}

describe('Shell commands (A11Y-05.3, A11Y-05.4, A11Y-02.4)', () => {
    it('registers every command with its name, for the palette', async () => {
        const { shell } = await setup();
        expect(shell.commands.list().map((command) => command.label)).toEqual([
            'Next region',
            'Previous region',
            'Show command palette',
            'Show notifications',
            'Show or hide the sidebar',
            'Tab moves focus',
            'Send next key to terminal',
            'Mute output announcements',
        ]);
    });

    it('toggles Tab focus mode in every terminal and says which way Tab goes', async () => {
        const { shell, terminals, spoken } = await setup();
        shell.run('terminal.toggleTabFocus');
        expect(terminals.tabFocusMode).toBe(true);
        expect(shell.state.getState().tabFocusMode).toBe(true);
        shell.run('terminal.toggleTabFocus');
        expect(spoken).toEqual(['Tab moves focus out of the terminal.', 'Tab goes to the terminal.']);
    });

    it('sends the next key only to an open session, and mutes that session’s output', async () => {
        const { shell, client, workspace, terminals, spoken } = await setup();
        shell.run('terminal.sendNextKey');
        shell.run('announcements.toggleMute');
        expect(spoken).toEqual(['No session is open.', 'No session is open.']);
        client.push('host-0', CONNECTED);
        await expect.poll(() => workspace.store.getState().sessions.get('host-0')?.length).toBe(1);
        workspace.open('host-0/a');
        shell.run('terminal.sendNextKey');
        shell.run('announcements.toggleMute');
        expect(terminals.nextKeys).toBe(1);
        expect(shell.isMuted('host-0/a')).toBe(true);
        shell.run('announcements.toggleMute');
        expect(shell.isMuted('host-0/a')).toBe(false);
        expect(spoken.slice(-3)).toEqual([
            'The next key goes to the terminal.',
            'Output announcements off for bash.',
            'Output announcements on for bash.',
        ]);
    });
});

describe('Shell sidebar and dialogs (US-1.6.3)', () => {
    it('hides and shows the sidebar column and keeps it, or the panel in a narrow window', async () => {
        const wide = await setup();
        wide.shell.run('sidebar.toggle');
        expect(wide.shell.state.getState().sidebarCollapsed).toBe(true);
        expect(wide.saved).toEqual([true]);
        expect(wide.spoken).toEqual(['Sidebar hidden.']);
        const narrow = await setup(true);
        narrow.shell.run('sidebar.toggle');
        expect(narrow.shell.state.getState()).toMatchObject({ panelOpen: true, sidebarCollapsed: false });
        expect(narrow.saved).toEqual([]);
    });

    it('opens the palette and the notification list', async () => {
        const { shell } = await setup();
        shell.run('palette.show');
        shell.run('notifications.show');
        expect(shell.state.getState()).toMatchObject({ paletteOpen: true, notificationsOpen: true });
    });
});

describe('Shell host reports (A11Y-12.1, A11Y-12.2)', () => {
    it('announces a connection, and announces and lists a lost one', async () => {
        const { shell, client, spoken } = await setup();
        client.push('host-0', CONNECTED);
        client.push('host-0', { status: 'disconnected', reason: { kind: 'timeout' } } as never);
        expect(spoken).toEqual(['devbox-1 connected.', '! Connection to devbox-1 lost.']);
        expect(shell.notifications.store.getState().items.map((item) => item.text)).toEqual([
            'Connection to devbox-1 lost.',
        ]);
    });

    it('lists every failed connection, and announces it unless its alert dialog already does', async () => {
        const { shell, client, workspace, spoken } = await setup();
        const failure = { kind: 'dns', host: 'devbox-1', details: '' } as const;
        workspace.connectAll();
        client.push('host-0', { status: 'failed', failure });
        expect(spoken).toEqual(['Couldn’t connect to devbox-1. devbox-1 couldn’t be found.']);
        workspace.toggleConnection('host-0');
        client.push('host-0', { status: 'connecting', step: 'connecting' } as never);
        client.push('host-0', { status: 'failed', failure });
        expect(spoken).toHaveLength(1);
        expect(shell.notifications.store.getState().items).toHaveLength(2);
    });
});
