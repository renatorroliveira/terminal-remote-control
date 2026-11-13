import { defineMessage, defineMessages } from 'react-intl';
import type { ScreenReaderMode } from '../../shared/accessibility';
import type { CommandId } from '../../shared/keymap';
import type { ActionFailureCode, FailedAction } from '../sessions/workspace-model';

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
    'terminal.zoomIn': {
        id: 'command.terminalZoomIn',
        defaultMessage: 'Bigger terminal text',
        description: 'Command name.',
    },
    'terminal.zoomOut': {
        id: 'command.terminalZoomOut',
        defaultMessage: 'Smaller terminal text',
        description: 'Command name.',
    },
    'terminal.zoomReset': {
        id: 'command.terminalZoomReset',
        defaultMessage: 'Default terminal text size',
        description: 'Command name.',
    },
    'review.toggle': {
        id: 'command.reviewToggle',
        defaultMessage: 'Review mode',
        description: 'Command name: opens or closes review mode, a read-only text field with the whole buffer.',
    },
    'terminal.find': { id: 'command.terminalFind', defaultMessage: 'Find…', description: 'Command name.' },
    'settings.show': { id: 'command.settingsShow', defaultMessage: 'Settings…', description: 'Command name.' },
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

/** The terminal text size after a change (A11Y-07.4). */
export const zoomAnnouncements = {
    level: defineMessage<{ zoom: number }>({
        id: 'announce.zoom',
        defaultMessage: 'Terminal text {zoom}%.',
        description: 'Announced after the terminal text size changes.',
    }),
    largest: defineMessage<{ zoom: number }>({
        id: 'announce.zoomLargest',
        defaultMessage: 'Terminal text {zoom}%, the largest.',
        description: 'Announced when the terminal text cannot grow any more.',
    }),
    smallest: defineMessage<{ zoom: number }>({
        id: 'announce.zoomSmallest',
        defaultMessage: 'Terminal text {zoom}%, the smallest.',
        description: 'Announced when the terminal text cannot shrink any more.',
    }),
};

/** The terminal's bell and new output below a scrolled-back viewport (A11Y-08.2, A11Y-08.4). */
export const terminalAnnouncements = {
    bell: defineMessage<{ session: string }>({
        id: 'announce.bell',
        defaultMessage: 'Bell in {session}.',
        description: 'Announced when the open session rings its bell.',
    }),
    outputBelow: defineMessage({
        id: 'announce.outputBelow',
        defaultMessage: 'New output below.',
        description: 'Announced once when output arrives while the user has scrolled the terminal back.',
    }),
    inputRefused: defineMessage({
        id: 'announce.inputRefused',
        defaultMessage: 'Disconnected — input not sent.',
        description: 'Announced assertively when the user types while the host is disconnected.',
    }),
};

/** Find and review mode (US-1.13, A11Y-03). */
export const findAnnouncements = {
    match: defineMessage<{ index: number; count: number }>({
        id: 'announce.findMatch',
        defaultMessage: 'Match {index, number} of {count, number}.',
        description: 'Announced as find selects a match.',
    }),
    none: defineMessage({ id: 'announce.findNone', defaultMessage: 'No matches.', description: 'Announcement.' }),
    reviewOutput: defineMessage({
        id: 'announce.reviewOutput',
        defaultMessage: 'New output. Command-Down Arrow goes to the end.',
        description: 'Announced once when output arrives while review mode is open.',
    }),
};

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

/** What failed, for an action failure's report (US-1.10, WCAG 3.3.1). */
export const failedActionMessages = defineMessages<FailedAction>({
    create: {
        id: 'failure.create',
        defaultMessage: 'Couldn’t create a session on {host}.',
        description: 'Reported when a new session fails.',
    },
    rename: {
        id: 'failure.rename',
        defaultMessage: 'Couldn’t rename the session on {host}.',
        description: 'Reported when a rename fails.',
    },
    stop: {
        id: 'failure.stop',
        defaultMessage: 'Couldn’t stop the session on {host}.',
        description: 'Reported when a stop fails.',
    },
    restart: {
        id: 'failure.restart',
        defaultMessage: 'Couldn’t restart the session on {host}.',
        description: 'Reported when a restart fails.',
    },
    close: {
        id: 'failure.close',
        defaultMessage: 'Couldn’t close the session on {host}.',
        description: 'Reported when closing a session fails.',
    },
    move: {
        id: 'failure.move',
        defaultMessage: 'Couldn’t move the session on {host}.',
        description: 'Reported when moving a session fails.',
    },
    forget: {
        id: 'failure.forget',
        defaultMessage: 'Couldn’t forget {host}.',
        description: 'Reported when forgetting a host fails.',
    },
    reattach: {
        id: 'failure.reattach',
        defaultMessage: 'Couldn’t reattach every session on {host}; they take no input.',
        description: 'Reported when sessions fail to reattach after a reconnect.',
    },
});

/** Why an action failed, after what failed (US-1.10, WCAG 3.3.1). */
export const failureReasonMessages = defineMessages<ActionFailureCode>({
    disconnected: {
        id: 'failure.reason.disconnected',
        defaultMessage: 'The host isn’t connected.',
        description: 'The action failed because the connection is gone.',
    },
    unknownSession: {
        id: 'failure.reason.unknownSession',
        defaultMessage: 'The session no longer exists.',
        description: 'The daemon no longer knows the session.',
    },
    spawnFailed: {
        id: 'failure.reason.spawnFailed',
        defaultMessage: 'The shell couldn’t start.',
        description: 'The daemon could not start the session’s program.',
    },
    badRequest: {
        id: 'failure.reason.badRequest',
        defaultMessage: 'The host refused the request.',
        description: 'The daemon found the request malformed.',
    },
    unsupported: {
        id: 'failure.reason.unsupported',
        defaultMessage: 'The host’s daemon doesn’t support it.',
        description: 'The daemon does not support the request.',
    },
    internal: {
        id: 'failure.reason.internal',
        defaultMessage: 'The host’s daemon hit an internal error.',
        description: 'The daemon failed internally.',
    },
    unspecified: {
        id: 'failure.reason.unspecified',
        defaultMessage: 'The host gave no reason.',
        description: 'The daemon refused without a code.',
    },
    unknown: {
        id: 'failure.reason.unknown',
        defaultMessage: 'Try again.',
        description: 'Nothing says why the action failed.',
    },
});

/** An action failure's report: what failed, then why (WCAG 3.3.1). */
export const actionFailedMessage = defineMessage<{ action: string; reason: string }>({
    id: 'announce.actionFailed',
    defaultMessage: '{action} {reason}',
    description: 'Announced and listed when a session or host action fails.',
});

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
    bell: defineMessage({
        id: 'status.bell',
        defaultMessage: 'Bell',
        description: 'Shown for a few seconds after the open session rang its bell.',
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
