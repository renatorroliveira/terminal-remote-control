import { defineMessage, defineMessages } from 'react-intl';

/** The session sidebar's UI strings (NFR-13). */
export const sidebarMessages = defineMessages({
    region: {
        id: 'sidebar.region',
        defaultMessage: 'Sessions',
        description: 'Name of the sidebar region and its heading.',
    },
    tree: {
        id: 'sidebar.tree',
        defaultMessage: 'Hosts and sessions',
        description: 'Accessible name of the tree of hosts and their sessions.',
    },
    newSession: {
        id: 'sidebar.newSession',
        defaultMessage: 'New session',
        description: 'Button that creates a session on the current host.',
    },
    toggle: {
        id: 'sidebar.toggle',
        defaultMessage: 'Sessions',
        description: 'Button that shows or hides the sidebar when the window is narrow.',
    },
    empty: {
        id: 'sidebar.empty',
        defaultMessage: 'No hosts yet.',
        description: 'Shown in the sidebar before any host is added.',
    },
});

/** Host connection states as text (US-1.6.2, A11Y-07.7). */
export const hostStateMessages = defineMessages({
    idle: { id: 'host.idle', defaultMessage: 'Not connected', description: 'Host connection state.' },
    connecting: { id: 'host.connecting', defaultMessage: 'Connecting', description: 'Host connection state.' },
    hostKey: {
        id: 'host.hostKey',
        defaultMessage: 'Host key needs confirmation',
        description: 'Host connection state while an unknown host key waits for the user.',
    },
    connected: { id: 'host.connected', defaultMessage: 'Connected', description: 'Host connection state.' },
    failed: { id: 'host.failed', defaultMessage: 'Connection failed', description: 'Host connection state.' },
    disconnected: { id: 'host.disconnected', defaultMessage: 'Disconnected', description: 'Host connection state.' },
    closed: { id: 'host.closed', defaultMessage: 'Closed', description: 'Host connection state.' },
});

/** Session states as text (US-1.9.2, US-1.9.3). */
export const sessionStateMessages = defineMessages({
    starting: { id: 'session.starting', defaultMessage: 'Starting', description: 'Session state.' },
    running: { id: 'session.running', defaultMessage: 'Running', description: 'Session state.' },
    exited: { id: 'session.exited', defaultMessage: 'Exited', description: 'Session state, exit status unknown.' },
    stopped: { id: 'session.stopped', defaultMessage: 'Stopped', description: 'Session state.' },
    failedToStart: { id: 'session.failedToStart', defaultMessage: 'Failed to start', description: 'Session state.' },
    unspecified: { id: 'session.unspecified', defaultMessage: 'Unknown state', description: 'Session state.' },
});

/** The terminal's accessible name and hint (A11Y-01.1, A11Y-01.2). */
export const terminalMessages = defineMessages({
    hint: {
        id: 'terminal.hint',
        defaultMessage: 'Option F1: accessibility help.',
        description: 'Hint read after the terminal name.',
    },
});

/** A host or session row's accessible name. */
export const treeItemMessage = defineMessage<{ name: string; state: string }>({
    id: 'sidebar.item',
    defaultMessage: '{name}, {state}',
    description: 'Accessible name of a host or session row: its name, then its state.',
});

/** A session state after the shell exited with a status code. */
export const exitedCodeMessage = defineMessage<{ code: number }>({
    id: 'session.exitedCode',
    defaultMessage: 'Exited with code {code}',
    description: 'Session state after the shell exited with a status code.',
});

/** A session state after a signal ended the shell. */
export const exitedSignalMessage = defineMessage<{ signal: string }>({
    id: 'session.exitedSignal',
    defaultMessage: 'Exited by signal {signal}',
    description: 'Session state after a signal ended the shell.',
});

/** A terminal's accessible name (A11Y-01.1). */
export const terminalLabelMessage = defineMessage<{ session: string; host: string }>({
    id: 'terminal.label',
    defaultMessage: '{session}, {host}',
    description: 'Accessible name of a terminal: the session name, then its host.',
});
