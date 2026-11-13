import type { IntlShape, MessageDescriptor } from 'react-intl';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { ScreenReaderMode } from '../../shared/accessibility';
import type { CommandId, Keymap } from '../../shared/keymap';
import type { LinkCheck } from '../../shared/links';
import { CommandRegistry } from '../commands/command-registry';
import { installShortcuts } from '../commands/shortcuts';
import { failureMessage } from '../sessions/failure-messages';
import {
    connectStepAnnouncement,
    connectStepMessages,
    hostActionMessages,
    touchMessage,
} from '../sessions/host-messages';
import { sessionStateText } from '../sessions/session-state-text';
import type { WorkspaceController } from '../sessions/workspace-controller';
import { type HostEntry, hostGroups, type SessionKey, sessionName, type Workspace } from '../sessions/workspace-model';
import { SELECTION_CAP } from '../terminal/ats-surface';
import type { TerminalLink } from '../terminal/hyperlinks';
import type { TerminalNotice } from '../terminal/notices';
import { pastedLines } from '../terminal/paste';
import type { Announcer } from './announcer';
import { linkAnnouncements } from './link-messages';
import type { NotificationCenter } from './notifications';
import { copyCappedMessage } from './paste-messages';
import { RegionCycler } from './regions';
import {
    commandMessages,
    hostAnnouncements,
    muteAnnouncements,
    openAnnouncements,
    screenReaderAnnouncements,
    shellAnnouncements,
} from './shell-messages';

/** What the shell's commands ask of the terminals. */
export interface TerminalControls {
    focusOpen(): boolean;
    setTabFocusMode(on: boolean): void;
    sendNextKey(): boolean;
    passingNextKey(): boolean;
    /** The links on the open terminal's screen (US-1.12.3). */
    visibleLinks(): readonly TerminalLink[];
    /** Pastes text into a session's terminal (US-1.12.2). */
    paste(key: SessionKey, text: string): void;
}

/** A paste of more than one line, waiting for the user's confirmation (US-1.12.2). */
export interface PasteDialog {
    readonly key: SessionKey;
    readonly text: string;
    readonly lines: number;
}

/** What the shell asks of the main process to open links (US-1.12.3, US-1.12.4). */
export interface LinkControls {
    check(target: string): Promise<LinkCheck | undefined>;
    open(target: string, trustOrigin: boolean): Promise<void>;
}

/** The link dialog open now: confirming one link, or choosing from the links on the screen. */
export type LinkDialog =
    | { readonly kind: 'confirm'; readonly text: string; readonly check: LinkCheck }
    | { readonly kind: 'list'; readonly links: readonly TerminalLink[] };

/** What the shell asks of screen-reader mode (A11Y-10.2). */
export interface ScreenReaderControls {
    /** The mode the user picked, or automatic. */
    readonly mode: ScreenReaderMode;
    /** Whether screen-reader mode is on now. */
    readonly screenReader: boolean;
    setMode(mode: ScreenReaderMode): Promise<void>;
    /** Calls `listener` whenever screen-reader mode turns on or off; returns a function that stops it. */
    onScreenReaderChanged(listener: (on: boolean) => void): () => void;
}

/** Where the sidebar's width and visibility are kept: `config.json` in the TRC home. */
export interface SidebarSettings {
    width(): Promise<number>;
    setWidth(width: number): Promise<void>;
    collapsed(): Promise<boolean>;
    setCollapsed(collapsed: boolean): Promise<void>;
}

/** The shell's own state, beside the workspace's. */
export interface ShellState {
    /** Whether Tab and Shift+Tab move focus out of the terminal (A11Y-05.4). */
    readonly tabFocusMode: boolean;
    /** Sessions whose output announcements the user muted (A11Y-02.4). */
    readonly muted: ReadonlySet<SessionKey>;
    readonly paletteOpen: boolean;
    readonly notificationsOpen: boolean;
    /** Whether the user hid the sidebar in a wide window (US-1.6.3). */
    readonly sidebarCollapsed: boolean;
    /** Whether the sidebar panel shows in a narrow window (A11Y-07.5). */
    readonly panelOpen: boolean;
    /** The host dialog open now: forgetting a host, or moving its install location. */
    readonly hostDialog: HostDialog | undefined;
    /** The session dialog open now: renaming or closing a session, or a new session with options. */
    readonly sessionDialog: SessionDialog | undefined;
    /** The link dialog open now (US-1.12.3). */
    readonly linkDialog: LinkDialog | undefined;
    /** The paste waiting for confirmation (US-1.12.2). */
    readonly pasteDialog: PasteDialog | undefined;
}

/** A dialog about a session, or the New session dialog. */
export type SessionDialog =
    | { readonly kind: 'rename' | 'close'; readonly key: SessionKey }
    | { readonly kind: 'new'; readonly hostId: string | undefined };

/** A dialog about one host. */
export interface HostDialog {
    readonly kind: 'forget' | 'install-root';
    readonly hostId: string;
}

/** What the shell is built from. */
export interface ShellOptions {
    readonly workspace: WorkspaceController;
    readonly terminals: TerminalControls;
    readonly sidebar: SidebarSettings;
    readonly announcer: Pick<Announcer, 'announce'>;
    readonly notifications: NotificationCenter;
    readonly keymap: Keymap;
    readonly intl: IntlShape;
    readonly document: Document;
    /** Whether the window is narrow enough that the sidebar is a panel. */
    readonly isNarrow: () => boolean;
    /** Screen-reader mode, when the app can change it. */
    readonly screenReader?: ScreenReaderControls;
    /** Where links open; without it, links do nothing. */
    readonly links?: LinkControls;
}

const INITIAL_STATE: ShellState = {
    tabFocusMode: false,
    muted: new Set(),
    paletteOpen: false,
    notificationsOpen: false,
    sidebarCollapsed: false,
    panelOpen: false,
    hostDialog: undefined,
    sessionDialog: undefined,
    linkDialog: undefined,
    pasteDialog: undefined,
};

/**
 * The workspace shell (US-1.6, A11Y-05): the commands every shortcut, menu item and the palette run, the regions they
 * move between, and the announcements and notifications that report what changed without moving focus (A11Y-12).
 */
export class Shell {
    readonly state: StoreApi<ShellState> = createStore<ShellState>(() => INITIAL_STATE);
    readonly commands = new CommandRegistry();
    readonly keymap: Keymap;
    readonly notifications: NotificationCenter;
    /** Where the sidebar's width and visibility are kept. */
    readonly sidebar: SidebarSettings;
    readonly #options: ShellOptions;
    readonly #regions: RegionCycler;
    #paletteReturn: HTMLElement | undefined;

    /** Builds the shell and registers its commands. */
    constructor(options: ShellOptions) {
        this.#options = options;
        this.keymap = options.keymap;
        this.notifications = options.notifications;
        this.sidebar = options.sidebar;
        this.#regions = new RegionCycler(options.document, { terminal: () => options.terminals.focusOpen() });
        this.#registerCommands();
    }

    /**
     * Starts the shell: the shortcut dispatcher, region focus memory, the saved sidebar visibility and host change
     * reports. Returns the stopper.
     */
    start(): () => void {
        const view = this.#options.document.defaultView;
        const stopShortcuts =
            view === null
                ? () => undefined
                : installShortcuts(view, {
                      keymap: this.keymap,
                      commands: this.commands,
                      passNextKey: () => this.#options.terminals.passingNextKey(),
                      blocked: () => this.#modalOpen(),
                  });
        const stopRegions = this.#regions.start();
        const stopHosts = this.#watchHosts();
        const stopScreenReader =
            this.#options.screenReader?.onScreenReaderChanged((on) => this.#announceScreenReader(on)) ??
            (() => undefined);
        void this.#options.sidebar.collapsed().then((sidebarCollapsed) => this.state.setState({ sidebarCollapsed }));
        return () => {
            stopShortcuts();
            stopRegions();
            stopHosts();
            stopScreenReader();
        };
    }

    /** Runs a command by ID, as the menus do; false when it is not registered. */
    run(id: CommandId): boolean {
        return this.commands.run(id);
    }

    /** Whether output announcements are muted for a session (A11Y-02.4). */
    isMuted(key: SessionKey): boolean {
        return this.state.getState().muted.has(key);
    }

    /** The screen-reader mode the user picked, when the app can change it. */
    get screenReaderMode(): ScreenReaderMode | undefined {
        return this.#options.screenReader?.mode;
    }

    /** Sets and keeps a screen-reader mode, and confirms the result when it was already in effect (A11Y-10.2). */
    async setScreenReaderMode(mode: ScreenReaderMode): Promise<void> {
        const controls = this.#options.screenReader;
        if (controls === undefined) {
            return;
        }
        const before = controls.screenReader;
        await controls.setMode(mode);
        if (controls.screenReader === before) {
            this.#announceScreenReader(before);
        }
    }

    /** Opens the command palette, remembering where focus was. */
    openPalette(): void {
        const active = this.#options.document.activeElement;
        this.#paletteReturn = active instanceof HTMLElement ? active : undefined;
        this.state.setState({ paletteOpen: true });
    }

    /** Closes the command palette, returns focus to where it was, then runs `then` (A11Y-05.8). */
    closePalette(then?: () => void): void {
        const returnTo = this.#paletteReturn;
        this.#paletteReturn = undefined;
        this.state.setState({ paletteOpen: false });
        setTimeout(() => {
            if (returnTo?.isConnected === true) {
                returnTo.focus();
            }
            then?.();
        }, 0);
    }

    /** Opens or closes the notification list. */
    setNotificationsOpen(notificationsOpen: boolean): void {
        this.state.setState({ notificationsOpen });
    }

    /** Shows or hides the sidebar panel of a narrow window. */
    setPanelOpen(panelOpen: boolean): void {
        this.state.setState({ panelOpen });
    }

    /** Opens a dialog about a host, or closes it. */
    setHostDialog(hostDialog: HostDialog | undefined): void {
        this.state.setState({ hostDialog });
    }

    /** Opens a session dialog, or closes it. */
    setSessionDialog(sessionDialog: SessionDialog | undefined): void {
        this.state.setState({ sessionDialog });
    }

    /** Asks before pasting text of more than one line into a session (US-1.12.2). */
    requestPaste(key: SessionKey, text: string): void {
        this.state.setState({ pasteDialog: { key, text, lines: pastedLines(text) } });
    }

    /** Pastes the text the confirmation shows. */
    confirmPaste(): void {
        const dialog = this.state.getState().pasteDialog;
        this.cancelPaste();
        if (dialog !== undefined) {
            this.#options.terminals.paste(dialog.key, dialog.text);
        }
    }

    /** Drops the paste waiting for confirmation. */
    cancelPaste(): void {
        this.state.setState({ pasteDialog: undefined });
    }

    /** Shows or announces what a terminal reported. */
    terminalNotice(_key: SessionKey, notice: TerminalNotice): void {
        if (notice.kind === 'copy-capped') {
            this.#options.announcer.announce(
                this.#options.intl.formatMessage(copyCappedMessage, { lines: notice.lines, cap: SELECTION_CAP }),
            );
        }
    }

    /** Opens a link dialog, or closes it. */
    setLinkDialog(linkDialog: LinkDialog | undefined): void {
        this.state.setState({ linkDialog });
    }

    /**
     * Opens a link from the terminal (US-1.12.3, US-1.12.4): at once when it starts with a trusted prefix, otherwise
     * after the confirmation; a target the app never opens is announced instead.
     */
    async openLink(link: TerminalLink): Promise<void> {
        const links = this.#options.links;
        if (links === undefined) {
            return;
        }
        const check = await links.check(link.target).catch(() => undefined);
        if (check === undefined) {
            this.setLinkDialog(undefined);
            this.#announce(linkAnnouncements.refused);
        } else if (check.trusted) {
            this.setLinkDialog(undefined);
            await links.open(check.target, false);
        } else {
            this.setLinkDialog({ kind: 'confirm', text: link.text, check });
        }
    }

    /** Opens the link the confirmation shows, first trusting its origin when `trustOrigin` is set. */
    async confirmLink(trustOrigin: boolean): Promise<void> {
        const dialog = this.state.getState().linkDialog;
        this.setLinkDialog(undefined);
        if (dialog?.kind === 'confirm') {
            await this.#options.links?.open(dialog.check.target, trustOrigin);
        }
    }

    /** Tests a host's connection and announces when it works; a failure shows the failure dialog (US-1.1.5). */
    async testConnection(hostId: string): Promise<void> {
        const host = this.#options.workspace.store.getState().hosts.find((entry) => entry.id === hostId);
        if (host !== undefined && (await this.#options.workspace.testConnection(hostId))) {
            this.#options.announcer.announce(
                this.#options.intl.formatMessage(hostActionMessages.testPassed, { host: host.destination }),
                { group: hostId },
            );
        }
    }

    /** Toggles Tab focus mode for every terminal and announces the new state (A11Y-05.4). */
    toggleTabFocus(): void {
        const tabFocusMode = !this.state.getState().tabFocusMode;
        this.state.setState({ tabFocusMode });
        this.#options.terminals.setTabFocusMode(tabFocusMode);
        this.#announce(tabFocusMode ? shellAnnouncements.tabMovesFocus : shellAnnouncements.tabToTerminal);
    }

    /** Toggles output announcements for the open session and announces the new state (A11Y-02.4). */
    toggleMute(): void {
        const { open, sessions, hosts } = this.#options.workspace.store.getState();
        const hostId = open?.split('/')[0];
        const session = sessions.get(hostId ?? '')?.find((info) => `${hostId}/${info.id}` === open);
        if (open === undefined || session === undefined || hosts.every((host) => host.id !== hostId)) {
            this.#announce(shellAnnouncements.noSession);
            return;
        }
        const muted = new Set(this.state.getState().muted);
        const nowMuted = !muted.delete(open);
        if (nowMuted) {
            muted.add(open);
        }
        this.state.setState({ muted });
        const message = nowMuted ? muteAnnouncements.muted : muteAnnouncements.unmuted;
        this.#options.announcer.announce(this.#options.intl.formatMessage(message, { session: sessionName(session) }));
    }

    /** Shows or hides the sidebar: a panel in a narrow window, otherwise the column, kept in `config.json`. */
    toggleSidebar(): void {
        if (this.#options.isNarrow()) {
            this.setPanelOpen(!this.state.getState().panelOpen);
            return;
        }
        const sidebarCollapsed = !this.state.getState().sidebarCollapsed;
        const sidebar = this.#options.document.querySelector('[data-region="sidebar"]');
        if (sidebarCollapsed && sidebar?.contains(this.#options.document.activeElement) === true) {
            this.#regions.next();
        }
        this.state.setState({ sidebarCollapsed });
        void this.#options.sidebar.setCollapsed(sidebarCollapsed);
        this.#announce(sidebarCollapsed ? shellAnnouncements.sidebarHidden : shellAnnouncements.sidebarShown);
    }

    #registerCommands(): void {
        const actions: Readonly<Partial<Record<CommandId, () => void>>> = {
            'region.next': () => this.#regions.next(),
            'region.previous': () => this.#regions.previous(),
            'palette.show': () => this.openPalette(),
            'notifications.show': () => this.setNotificationsOpen(true),
            'sidebar.toggle': () => this.toggleSidebar(),
            'terminal.toggleTabFocus': () => this.toggleTabFocus(),
            'terminal.sendNextKey': () => this.#sendNextKey(),
            'announcements.toggleMute': () => this.toggleMute(),
            'session.new': () => this.#newSession(),
            'session.newWithOptions': () =>
                this.setSessionDialog({ kind: 'new', hostId: this.#options.workspace.defaultHost() }),
            'session.next': () => this.#options.workspace.openNext(1),
            'session.previous': () => this.#options.workspace.openNext(-1),
            'terminal.listLinks': () => this.#listLinks(),
        };
        for (const [id, run] of Object.entries(actions) as [CommandId, () => void][]) {
            this.commands.register({ id, label: this.#options.intl.formatMessage(commandMessages[id]), run });
        }
    }

    #newSession(): void {
        if (this.#options.workspace.defaultHost() === undefined) {
            this.#announce(shellAnnouncements.noHost);
            return;
        }
        void this.#options.workspace.newSessionHere();
    }

    #listLinks(): void {
        const links = this.#options.terminals.visibleLinks();
        if (links.length === 0) {
            this.#announce(linkAnnouncements.none);
            return;
        }
        this.setLinkDialog({ kind: 'list', links });
    }

    #sendNextKey(): void {
        const armed = this.#options.terminals.sendNextKey();
        this.#announce(armed ? shellAnnouncements.nextKey : shellAnnouncements.noSession);
    }

    #announceScreenReader(on: boolean): void {
        this.#announce(on ? screenReaderAnnouncements.on : screenReaderAnnouncements.off);
    }

    #announce(message: MessageDescriptor): void {
        this.#options.announcer.announce(this.#options.intl.formatMessage(message));
    }

    #modalOpen(): boolean {
        return this.#options.document.querySelector('[aria-modal="true"]') !== null;
    }

    #watchHosts(): () => void {
        const store = this.#options.workspace.store;
        let previous = store.getState().hosts;
        let before = store.getState();
        const stopOpen = store.subscribe((state) => {
            if (state.open !== undefined && state.open !== before.open) {
                this.#announceOpen(state, before.unread.has(state.open));
            }
            before = state;
        });
        const stopHosts = store.subscribe((state) => {
            for (const host of state.hosts) {
                const before = previous.find((entry) => entry.id === host.id);
                if (before !== undefined && before.state.status !== host.state.status) {
                    this.#reportHost(host, state.failureNotice === host.id);
                }
                if (before !== undefined && before.state !== host.state) {
                    this.#reportProgress(before, host);
                }
            }
            previous = state.hosts;
        });
        return () => {
            stopOpen();
            stopHosts();
        };
    }

    #announceOpen(state: Workspace, unread: boolean): void {
        const { intl, announcer } = this.#options;
        for (const group of hostGroups(state)) {
            const item = group.sessions.find((entry) => entry.key === state.open);
            if (item !== undefined) {
                const message = unread ? openAnnouncements.openedUnread : openAnnouncements.opened;
                const values = {
                    session: item.label,
                    host: group.host.destination,
                    state: sessionStateText(intl, item),
                };
                announcer.announce(intl.formatMessage(message, values), { group: 'open-session' });
            }
        }
    }

    #reportProgress(before: HostEntry, host: HostEntry): void {
        const { intl, announcer } = this.#options;
        const was = before.state;
        const now = host.state;
        if (now.status !== 'connecting') {
            return;
        }
        if (now.touch !== undefined && (was.status !== 'connecting' || was.touch === undefined)) {
            announcer.announce(intl.formatMessage(touchMessage, { host: host.destination }), {
                group: `${host.id}:touch`,
                politeness: 'assertive',
            });
        }
        if (was.status !== 'connecting' || was.step !== now.step) {
            const step = intl.formatMessage(connectStepMessages[now.step]);
            announcer.announce(intl.formatMessage(connectStepAnnouncement, { host: host.destination, step }), {
                group: host.id,
            });
        }
    }

    #reportHost(host: HostEntry, inDialog: boolean): void {
        const { intl, announcer, notifications } = this.#options;
        const state = host.state;
        if (state.status === 'connected') {
            announcer.announce(intl.formatMessage(hostAnnouncements.connected, { host: host.destination }), {
                group: host.id,
            });
        } else if (state.status === 'disconnected') {
            const text = intl.formatMessage(hostAnnouncements.disconnected, { host: host.destination });
            announcer.announce(text, { group: host.id, politeness: 'assertive' });
            notifications.add({ text, level: 'error' });
        } else if (state.status === 'failed' && state.failure.kind !== 'host-key-rejected') {
            const { problem } = failureMessage(intl, host.destination, state.failure);
            const text = intl.formatMessage(hostAnnouncements.failed, { host: host.destination, problem });
            notifications.add({ text, level: 'error' });
            if (!inDialog) {
                announcer.announce(text, { group: host.id });
            }
        }
    }
}
