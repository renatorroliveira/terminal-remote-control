import { createIntl } from 'react-intl';
import { describe, expect, it, onTestFinished } from 'vitest';
import type { ScreenReaderMode } from '../../shared/accessibility';
import { resolveKeymap } from '../../shared/keymap';
import type { LinkCheck } from '../../shared/links';
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
import { type LinkControls, type ScreenReaderControls, Shell } from './shell';
import { paletteActions } from './workspace-actions';

/** Link checks and opens as the main process would do them. */
class FakeLinks implements LinkControls {
    readonly trusted: string[] = [];
    readonly opened: { readonly target: string; readonly trustOrigin: boolean }[] = [];

    async check(target: string): Promise<LinkCheck | undefined> {
        if (target.startsWith('javascript:')) {
            return undefined;
        }
        const origin = /^[a-z]+:\/\/[^/]+/.exec(target)?.[0];
        return { target, origin, trusted: this.trusted.some((prefix) => target.startsWith(prefix)) };
    }

    async open(target: string, trustOrigin: boolean): Promise<void> {
        this.opened.push({ target, trustOrigin });
    }
}

/** Screen-reader mode as the main process would keep it. */
class FakeScreenReader implements ScreenReaderControls {
    mode: ScreenReaderMode = 'auto';
    detected = false;
    readonly #listeners = new Set<(on: boolean) => void>();

    get screenReader(): boolean {
        return this.mode === 'auto' ? this.detected : this.mode === 'on';
    }

    async setMode(mode: ScreenReaderMode): Promise<void> {
        this.#change(() => {
            this.mode = mode;
        });
    }

    detect(detected: boolean): void {
        this.#change(() => {
            this.detected = detected;
        });
    }

    onScreenReaderChanged(listener: (on: boolean) => void): () => void {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }

    #change(apply: () => void): void {
        const was = this.screenReader;
        apply();
        if (this.screenReader !== was) {
            for (const listener of this.#listeners) {
                listener(this.screenReader);
            }
        }
    }
}

const CONNECTED = { status: 'connected', daemon: { version: '0.2.0', sha256: 'ab', proto: 1 } } as const;

async function setup(narrow = false) {
    const client = new FakeWorkspaceClient([bashSession('a')]);
    const terminals = new FakeTerminalHost([]);
    const workspace = new WorkspaceController(client, terminals, new FakeKnownHostStore());
    const spoken: string[] = [];
    const saved: boolean[] = [];
    const screenReader = new FakeScreenReader();
    const links = new FakeLinks();
    const intl = createIntl({ locale: 'en', messages: messagesFor('en') });
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
        intl,
        document,
        isNarrow: () => narrow,
        screenReader,
        links,
    });
    onTestFinished(shell.start());
    await workspace.addHost('devbox-1');
    return { client, terminals, workspace, shell, spoken, saved, screenReader, intl, links };
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
            'New session',
            'New session with options…',
            'Next session',
            'Previous session',
            'List links…',
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

describe('Shell screen-reader mode (A11Y-10.2)', () => {
    it('announces when screen-reader mode turns on or off', async () => {
        const { screenReader, spoken } = await setup();
        screenReader.detect(true);
        screenReader.detect(false);
        expect(spoken).toEqual(['Screen reader mode on.', 'Screen reader mode off.']);
    });

    it('sets the mode the user picks, and confirms it when the mode was already in effect', async () => {
        const { shell, screenReader, spoken } = await setup();
        screenReader.detect(true);
        await shell.setScreenReaderMode('off');
        await shell.setScreenReaderMode('auto');
        await shell.setScreenReaderMode('on');
        expect(screenReader.mode).toBe('on');
        expect(spoken).toEqual([
            'Screen reader mode on.',
            'Screen reader mode off.',
            'Screen reader mode on.',
            'Screen reader mode on.',
        ]);
    });

    it('offers the other screen-reader modes in the command palette', async () => {
        const { shell, workspace, screenReader, intl } = await setup();
        const labels = (): string[] =>
            paletteActions(intl, shell, workspace)
                .map((action) => action.label)
                .filter((label) => label.startsWith('Screen reader'));
        expect(labels()).toEqual(['Screen reader mode: on', 'Screen reader mode: off']);
        await screenReader.setMode('off');
        expect(labels()).toEqual(['Screen reader mode: automatic', 'Screen reader mode: on']);
    });
});

describe('Shell links (US-1.12.3, US-1.12.4)', () => {
    it('opens a link that starts with a trusted prefix at once', async () => {
        const { shell, links } = await setup();
        links.trusted.push('https://github.com');
        await shell.openLink({ text: 'issues', target: 'https://github.com/trc/issues' });
        expect(links.opened).toEqual([{ target: 'https://github.com/trc/issues', trustOrigin: false }]);
        expect(shell.state.getState().linkDialog).toBeUndefined();
    });

    it('asks before opening any other link, then opens it, trusting its origin when the user asks', async () => {
        const { shell, links } = await setup();
        await shell.openLink({ text: 'the docs', target: 'https://example.com/docs' });
        expect(shell.state.getState().linkDialog).toEqual({
            kind: 'confirm',
            text: 'the docs',
            check: { target: 'https://example.com/docs', origin: 'https://example.com', trusted: false },
        });
        expect(links.opened).toEqual([]);
        await shell.confirmLink(true);
        expect(links.opened).toEqual([{ target: 'https://example.com/docs', trustOrigin: true }]);
        expect(shell.state.getState().linkDialog).toBeUndefined();
    });

    it('says when it will not open a link', async () => {
        const { shell, links, spoken } = await setup();
        await shell.openLink({ text: 'click me', target: 'javascript:alert(1)' });
        expect(links.opened).toEqual([]);
        expect(spoken).toEqual(['TRC doesn’t open this kind of link.']);
    });

    it('lists the links on the screen, or says there are none', async () => {
        const { shell, terminals, spoken } = await setup();
        shell.run('terminal.listLinks');
        expect(spoken).toEqual(['No links on the screen.']);
        terminals.links = [{ text: 'https://example.com', target: 'https://example.com' }];
        shell.run('terminal.listLinks');
        expect(shell.state.getState().linkDialog).toEqual({ kind: 'list', links: terminals.links });
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
        let ran = false;
        shell.closePalette(() => {
            ran = true;
        });
        expect(shell.state.getState().paletteOpen).toBe(false);
        await expect.poll(() => ran).toBe(true);
    });
});

describe('Shell connection progress (US-1.4.5, US-1.3.2)', () => {
    it('announces each step politely and a security-key touch assertively', async () => {
        const { client, spoken } = await setup();
        client.push('host-0', { status: 'connecting', step: 'connecting', touch: undefined });
        client.push('host-0', { status: 'connecting', step: 'connecting', touch: 'Confirm user presence' });
        client.push('host-0', { status: 'connecting', step: 'uploading', touch: undefined });
        expect(spoken).toEqual([
            'devbox-1: Connecting.',
            '! Touch your security key for devbox-1',
            'devbox-1: Uploading the daemon.',
        ]);
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
        expect(spoken).toEqual(['Couldn’t connect to devbox-1. devbox-1 couldn’t be found.', 'devbox-1: Connecting.']);
        expect(shell.notifications.store.getState().items).toHaveLength(2);
    });
});
