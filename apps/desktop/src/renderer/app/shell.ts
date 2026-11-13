import type { IntlShape, MessageDescriptor } from 'react-intl';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { CommandId, Keymap } from '../../shared/keymap';
import { CommandRegistry } from '../commands/command-registry';
import { installShortcuts } from '../commands/shortcuts';
import { failureMessage } from '../sessions/failure-messages';
import type { WorkspaceController } from '../sessions/workspace-controller';
import { type HostEntry, type SessionKey, sessionName } from '../sessions/workspace-model';
import type { Announcer } from './announcer';
import type { NotificationCenter } from './notifications';
import { RegionCycler } from './regions';
import { commandMessages, hostAnnouncements, muteAnnouncements, shellAnnouncements } from './shell-messages';

/** What the shell's commands ask of the terminals. */
export interface TerminalControls {
    focusOpen(): boolean;
    setTabFocusMode(on: boolean): void;
    sendNextKey(): boolean;
    passingNextKey(): boolean;
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
}

const INITIAL_STATE: ShellState = {
    tabFocusMode: false,
    muted: new Set(),
    paletteOpen: false,
    notificationsOpen: false,
    sidebarCollapsed: false,
    panelOpen: false,
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
        void this.#options.sidebar.collapsed().then((sidebarCollapsed) => this.state.setState({ sidebarCollapsed }));
        return () => {
            stopShortcuts();
            stopRegions();
            stopHosts();
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

    /** Opens or closes the command palette. */
    setPaletteOpen(paletteOpen: boolean): void {
        this.state.setState({ paletteOpen });
    }

    /** Opens or closes the notification list. */
    setNotificationsOpen(notificationsOpen: boolean): void {
        this.state.setState({ notificationsOpen });
    }

    /** Shows or hides the sidebar panel of a narrow window. */
    setPanelOpen(panelOpen: boolean): void {
        this.state.setState({ panelOpen });
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
            'palette.show': () => this.setPaletteOpen(true),
            'notifications.show': () => this.setNotificationsOpen(true),
            'sidebar.toggle': () => this.toggleSidebar(),
            'terminal.toggleTabFocus': () => this.toggleTabFocus(),
            'terminal.sendNextKey': () => this.#sendNextKey(),
            'announcements.toggleMute': () => this.toggleMute(),
        };
        for (const [id, run] of Object.entries(actions) as [CommandId, () => void][]) {
            this.commands.register({ id, label: this.#options.intl.formatMessage(commandMessages[id]), run });
        }
    }

    #sendNextKey(): void {
        const armed = this.#options.terminals.sendNextKey();
        this.#announce(armed ? shellAnnouncements.nextKey : shellAnnouncements.noSession);
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
        return store.subscribe((state) => {
            for (const host of state.hosts) {
                const before = previous.find((entry) => entry.id === host.id);
                if (before !== undefined && before.state.status !== host.state.status) {
                    this.#reportHost(host, state.failureNotice === host.id);
                }
            }
            previous = state.hosts;
        });
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
