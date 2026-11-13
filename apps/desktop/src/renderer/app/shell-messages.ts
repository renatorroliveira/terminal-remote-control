import { defineMessage, defineMessages } from 'react-intl';
import type { ScreenReaderMode } from '../../shared/accessibility';
import type { CommandId } from '../../shared/keymap';

/** Each command's name in the palette and in accessibility help (docs/design/keymap.md). */
export const commandMessages = defineMessages<CommandId>({
    'region.next': { id: 'command.regionNext', defaultMessage: 'Next region', description: 'Command name.' },
    'region.previous': {
        id: 'command.regionPrevious',
        defaultMessage: 'Previous region',
        description: 'Command name.',
    },
    'palette.show': {
        id: 'command.paletteShow',
        defaultMessage: 'Show command palette',
        description: 'Command name.',
    },
    'sidebar.toggle': {
        id: 'command.sidebarToggle',
        defaultMessage: 'Show or hide the sidebar',
        description: 'Command name.',
    },
    'terminal.toggleTabFocus': {
        id: 'command.terminalToggleTabFocus',
        defaultMessage: 'Tab moves focus',
        description: 'Command name: toggles whether Tab leaves the terminal.',
    },
    'terminal.sendNextKey': {
        id: 'command.terminalSendNextKey',
        defaultMessage: 'Send next key to terminal',
        description: 'Command name.',
    },
    'announcements.toggleMute': {
        id: 'command.announcementsToggleMute',
        defaultMessage: 'Mute output announcements',
        description: 'Command name: toggles spoken output for the open session.',
    },
    'notifications.show': {
        id: 'command.notificationsShow',
        defaultMessage: 'Show notifications',
        description: 'Command name.',
    },
    'help.accessibility': {
        id: 'command.helpAccessibility',
        defaultMessage: 'Accessibility help',
        description: 'Command name.',
    },
    'help.userGuide': { id: 'command.helpUserGuide', defaultMessage: 'User guide', description: 'Command name.' },
    'session.new': { id: 'command.sessionNew', defaultMessage: 'New session', description: 'Command name.' },
    'session.newWithOptions': {
        id: 'command.sessionNewWithOptions',
        defaultMessage: 'New session with options…',
        description: 'Command name: opens the New session dialog.',
    },
    'session.next': { id: 'command.sessionNext', defaultMessage: 'Next session', description: 'Command name.' },
    'session.previous': {
        id: 'command.sessionPrevious',
        defaultMessage: 'Previous session',
        description: 'Command name.',
    },
    'terminal.listLinks': {
        id: 'command.terminalListLinks',
        defaultMessage: 'List links…',
        description: 'Command name: lists the links on the terminal screen to open one (US-1.12.3).',
    },
});

/** What the shell announces when a command changes something (A11Y-05.4, A11Y-12.1). */
export const shellAnnouncements = defineMessages({
    tabMovesFocus: {
        id: 'announce.tabMovesFocus',
        defaultMessage: 'Tab moves focus out of the terminal.',
        description: 'Announced when Tab focus mode turns on.',
    },
    tabToTerminal: {
        id: 'announce.tabToTerminal',
        defaultMessage: 'Tab goes to the terminal.',
        description: 'Announced when Tab focus mode turns off.',
    },
    nextKey: {
        id: 'announce.nextKey',
        defaultMessage: 'The next key goes to the terminal.',
        description: 'Announced after the send-next-key command.',
    },
    noSession: {
        id: 'announce.noSession',
        defaultMessage: 'No session is open.',
        description: 'Announced when a command needs an open session.',
    },
    sidebarHidden: { id: 'announce.sidebarHidden', defaultMessage: 'Sidebar hidden.', description: 'Announcement.' },
    noHost: {
        id: 'announce.noHost',
        defaultMessage: 'No host is connected.',
        description: 'Announced when a new session needs a connected host.',
    },
    sidebarShown: { id: 'announce.sidebarShown', defaultMessage: 'Sidebar shown.', description: 'Announcement.' },
});

/** Screen-reader mode turning on or off (A11Y-10.2). */
export const screenReaderAnnouncements = defineMessages({
    on: {
        id: 'announce.screenReaderOn',
        defaultMessage: 'Screen reader mode on.',
        description: 'Announced when screen-reader mode turns on: the open session’s output is spoken.',
    },
    off: {
        id: 'announce.screenReaderOff',
        defaultMessage: 'Screen reader mode off.',
        description: 'Announced when screen-reader mode turns off.',
    },
});

/** The palette entries that pick a screen-reader mode (A11Y-10.2). */
export const screenReaderModeMessages = defineMessages<ScreenReaderMode>({
    auto: {
        id: 'palette.screenReaderAuto',
        defaultMessage: 'Screen reader mode: automatic',
        description: 'Palette entry: screen-reader mode follows whether assistive technology is detected.',
    },
    on: {
        id: 'palette.screenReaderOn',
        defaultMessage: 'Screen reader mode: on',
        description: 'Palette entry: forces screen-reader mode on.',
    },
    off: {
        id: 'palette.screenReaderOff',
        defaultMessage: 'Screen reader mode: off',
        description: 'Palette entry: forces screen-reader mode off.',
    },
});

/** Mute state announcements, naming the session. */
export const muteAnnouncements = {
    muted: defineMessage<{ session: string }>({
        id: 'announce.muted',
        defaultMessage: 'Output announcements off for {session}.',
        description: 'Announced when output announcements are muted for a session.',
    }),
    unmuted: defineMessage<{ session: string }>({
        id: 'announce.unmuted',
        defaultMessage: 'Output announcements on for {session}.',
        description: 'Announced when output announcements are unmuted for a session.',
    }),
};

/** What opening a session announces (US-1.8.3). */
export const openAnnouncements = {
    opened: defineMessage<{ session: string; host: string; state: string }>({
        id: 'announce.opened',
        defaultMessage: '{session} on {host}: {state}.',
        description: 'Announced politely when a session opens.',
    }),
    openedUnread: defineMessage<{ session: string; host: string; state: string }>({
        id: 'announce.openedUnread',
        defaultMessage: '{session} on {host}: {state}, new output.',
        description: 'Announced politely when a session with unseen output opens.',
    }),
};

/** Host connection changes, announced and kept in the notification list (A11Y-12.2). */
export const hostAnnouncements = {
    connected: defineMessage<{ host: string }>({
        id: 'announce.hostConnected',
        defaultMessage: '{host} connected.',
        description: 'Announced when a host connects.',
    }),
    disconnected: defineMessage<{ host: string }>({
        id: 'announce.hostDisconnected',
        defaultMessage: 'Connection to {host} lost.',
        description: 'Announced and listed when a working connection ends.',
    }),
    failed: defineMessage<{ host: string; problem: string }>({
        id: 'announce.hostFailed',
        defaultMessage: 'Couldn’t connect to {host}. {problem}',
        description: 'Announced and listed when a connection fails.',
    }),
};

/** The status bar (US-1.6.1). */
export const statusMessages = {
    region: defineMessage({ id: 'status.region', defaultMessage: 'Status bar', description: 'Landmark name.' }),
    hostState: defineMessage<{ host: string; state: string }>({
        id: 'status.hostState',
        defaultMessage: '{host}: {state}',
        description: 'The open session’s host and its connection state.',
    }),
    hostsConnected: defineMessage<{ connected: number; total: number }>({
        id: 'status.hostsConnected',
        defaultMessage: '{connected} of {total} hosts connected',
        description: 'Shown while no session is open.',
    }),
    noHosts: defineMessage({ id: 'status.noHosts', defaultMessage: 'No hosts', description: 'Status bar text.' }),
    daemon: defineMessage<{ version: string }>({
        id: 'status.daemon',
        defaultMessage: 'Daemon {version}',
        description: 'The version of the daemon the open session’s host runs.',
    }),
    noDaemon: defineMessage({
        id: 'status.noDaemon',
        defaultMessage: 'Daemon not reached',
        description: 'Shown while the open session’s host is not connected.',
    }),
    tabMovesFocus: defineMessage({
        id: 'status.tabMovesFocus',
        defaultMessage: 'Tab moves focus',
        description: 'Toggle button: whether Tab leaves the terminal.',
    }),
    mute: defineMessage({
        id: 'status.mute',
        defaultMessage: 'Mute output',
        description: 'Toggle button: mutes spoken output for the open session.',
    }),
    notifications: defineMessage<{ count: number }>({
        id: 'status.notifications',
        defaultMessage: 'Notifications {count}',
        description: 'Button that opens the notification list, with how many it holds.',
    }),
};

/** The command palette (A11Y-11.11). */
export const paletteMessages = {
    title: defineMessage({ id: 'palette.title', defaultMessage: 'Command palette', description: 'Dialog name.' }),
    search: defineMessage({ id: 'palette.search', defaultMessage: 'Command', description: 'Search field label.' }),
    empty: defineMessage({ id: 'palette.empty', defaultMessage: 'No matching command.', description: 'Empty list.' }),
    newSession: defineMessage<{ host: string }>({
        id: 'palette.newSession',
        defaultMessage: 'New session on {host}',
        description: 'Palette entry.',
    }),
    openSession: defineMessage<{ session: string; host: string }>({
        id: 'palette.openSession',
        defaultMessage: 'Open {session} on {host}',
        description: 'Palette entry.',
    }),
};

/** The notification list (TECH_STACK §4.3). */
export const notificationMessages = {
    title: defineMessage({ id: 'notifications.title', defaultMessage: 'Notifications', description: 'Dialog name.' }),
    empty: defineMessage({
        id: 'notifications.empty',
        defaultMessage: 'No notifications.',
        description: 'Shown when the list is empty.',
    }),
    dismiss: defineMessage({
        id: 'notifications.dismiss',
        defaultMessage: 'Dismiss',
        description: 'Button that removes one notification.',
    }),
    dismissNamed: defineMessage<{ text: string }>({
        id: 'notifications.dismissNamed',
        defaultMessage: 'Dismiss: {text}',
        description: 'Accessible name of the Dismiss button; starts with its visible label and names the notification.',
    }),
    clear: defineMessage({ id: 'notifications.clear', defaultMessage: 'Clear all', description: 'Button.' }),
    close: defineMessage({ id: 'notifications.close', defaultMessage: 'Close', description: 'Button.' }),
};

/** Context menus (A11Y-11.11). */
export const contextMenuMessages = {
    label: defineMessage<{ target: string }>({
        id: 'contextMenu.label',
        defaultMessage: 'Actions for {target}',
        description: 'Context menu name.',
    }),
    open: defineMessage({ id: 'contextMenu.open', defaultMessage: 'Open', description: 'Context menu item.' }),
};
