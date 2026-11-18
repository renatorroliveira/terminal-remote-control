import { defineMessage, defineMessages } from 'react-intl';
import type { ConnectionState } from '../../shared/connection';
import type { ConnectionAction } from './workspace-controller';

/** The session sidebar's UI strings (NFR-13). */
export const sidebarMessages = defineMessages({
    region: {
        id: 'sidebar.region',
        defaultMessage: 'Sessions and hosts',
        description: 'Name of the sidebar region.',
    },
    sessions: {
        id: 'sidebar.sessions',
        defaultMessage: 'Sessions',
        description: 'Heading of the sidebar area that lists open sessions.',
    },
    hosts: {
        id: 'sidebar.hosts',
        defaultMessage: 'Hosts',
        description: 'Heading of the sidebar area that lists known hosts.',
    },
    noSessions: {
        id: 'sidebar.noSessions',
        defaultMessage: 'No open sessions.',
        description: 'Shown in the sessions area while no session is open.',
    },
    knownHosts: {
        id: 'sidebar.knownHosts',
        defaultMessage: 'Known hosts',
        description: 'Accessible name of the list of known hosts.',
    },
    newHost: {
        id: 'sidebar.newHost',
        defaultMessage: 'New host',
        description: 'Label of the field where the user types a host to add.',
    },
    newHostHint: {
        id: 'sidebar.newHostHint',
        defaultMessage: 'An SSH alias, or user@host:port.',
        description: 'Help text under the new host field.',
    },
    addHost: {
        id: 'sidebar.addHost',
        defaultMessage: 'Add host',
        description: 'Button that adds the typed host to the known hosts.',
    },
    badAddress: {
        id: 'sidebar.badAddress',
        defaultMessage: 'Not a host address. Type an SSH alias, or user@host:port.',
        description: 'Error shown when the typed host cannot be used.',
    },
    trust: {
        id: 'sidebar.trust',
        defaultMessage: 'Trust',
        description: 'Button that trusts a presented host key.',
    },
    reject: {
        id: 'sidebar.reject',
        defaultMessage: 'Reject',
        description: 'Button that refuses a presented host key.',
    },
    settings: {
        id: 'sidebar.settings',
        defaultMessage: 'Settings',
        description: 'The link at the bottom of the sidebar that shows the settings (US-1.6.7).',
    },
    toggle: {
        id: 'sidebar.toggle',
        defaultMessage: 'Sessions and hosts',
        description: 'Button that shows or hides the sidebar when the window is narrow.',
    },
    empty: {
        id: 'sidebar.empty',
        defaultMessage: 'No hosts yet.',
        description: 'Shown in the hosts area before any host is added.',
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
    connectedEndsAtLogout: {
        id: 'host.connectedEndsAtLogout',
        defaultMessage: 'Connected; programs end when its last connection closes',
        description: 'Host state when the host ends the user’s processes at logout and lingering is off (US-2.4.4).',
    },
    failed: { id: 'host.failed', defaultMessage: 'Connection failed', description: 'Host connection state.' },
    disconnected: { id: 'host.disconnected', defaultMessage: 'Disconnected', description: 'Host connection state.' },
    reconnecting: {
        id: 'host.reconnecting',
        defaultMessage: 'Reconnecting',
        description: 'Host connection state while the app reconnects a lost host by itself.',
    },
    closed: { id: 'host.closed', defaultMessage: 'Closed', description: 'Host connection state.' },
    daemonRemoved: {
        id: 'host.daemonRemoved',
        defaultMessage: 'Daemon removed',
        description: 'Host state after the user removed its daemon; connecting installs it again (P-45).',
    },
    restartingDaemon: {
        id: 'host.restartingDaemon',
        defaultMessage: 'Restarting the daemon',
        description: 'Host state while its daemon restarts at the user’s request (US-3.3.2).',
    },
    removingDaemon: {
        id: 'host.removingDaemon',
        defaultMessage: 'Removing the daemon',
        description: 'Host state while the app removes its daemon (US-3.3.3).',
    },
});

/** A session whose host reconnects by itself (US-2.2.2). */
export const sessionReconnectingMessage = defineMessage({
    id: 'session.reconnecting',
    defaultMessage: 'Reconnecting',
    description: 'Session state while its host reconnects by itself.',
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

/** A session whose host is not connected (US-1.14.1). */
export const sessionDisconnectedMessage = defineMessage({
    id: 'session.disconnected',
    defaultMessage: 'Disconnected',
    description: 'Session state while its host is not connected.',
});

/** The terminal's accessible name and hint (A11Y-01.1, A11Y-01.2). */
export const terminalMessages = defineMessages({
    hint: {
        id: 'terminal.hint',
        defaultMessage: 'Option F1: accessibility help.',
        description: 'Hint read after the terminal name.',
    },
    outputBelow: {
        id: 'terminal.outputBelow',
        defaultMessage: 'New output below',
        description: 'Indicator on a terminal scrolled back while new output arrives; clicking it jumps to the end.',
    },
    inputRefused: {
        id: 'terminal.inputRefused',
        defaultMessage: 'Disconnected — input not sent',
        description: 'Shown and announced when the user types while the host is disconnected; nothing was sent.',
    },
    inputReconnecting: {
        id: 'terminal.inputReconnecting',
        defaultMessage: 'Reconnecting — input not sent',
        description: 'Shown and announced when the user types while the host reconnects; nothing was sent.',
    },
    sizeSetElsewhere: {
        id: 'terminal.sizeSetElsewhere',
        defaultMessage: 'Size set by another client.',
        description: 'Added to the terminal description while another computer set the shared session’s size.',
    },
    inputNotReady: {
        id: 'terminal.inputNotReady',
        defaultMessage: 'Session still opening — input not sent',
        description: 'Shown when the user types before a session has attached; nothing was sent.',
    },
    inputElsewhere: {
        id: 'terminal.inputElsewhere',
        defaultMessage: 'Opened on another client — input not sent',
        description:
            'Shown when the user types into a session another computer opened, which serves one client at a time; nothing was sent.',
    },
});

/** A host or session row's accessible name. */
export const sessionRowMessage = defineMessage<{ name: string; state: string }>({
    id: 'sidebar.item',
    defaultMessage: '{name}, {state}',
    description: 'Accessible name of a session row: its name, then its state.',
});

/** Per-host names in the Sessions area. */
export const hostSessionsMessages = {
    newSession: defineMessage<{ host: string }>({
        id: 'sidebar.newSessionOn',
        defaultMessage: 'New session on {host}',
        description: 'Accessible name of the + button that starts a session on a connected host.',
    }),
    sessions: defineMessage<{ host: string }>({
        id: 'sidebar.sessionsOn',
        defaultMessage: 'Sessions on {host}',
        description: 'Accessible name of the list of a host’s sessions.',
    }),
};

/** The splitter between the sidebar and the terminal area (US-1.6.3). */
export const splitterMessages = {
    ...defineMessages({
        label: {
            id: 'sidebar.splitter',
            defaultMessage: 'Sidebar width',
            description: 'Accessible name of the handle that resizes the sidebar.',
        },
    }),
    value: defineMessage<{ width: number }>({
        id: 'sidebar.splitterValue',
        defaultMessage: '{width} pixels',
        description: 'The sidebar width the splitter reports.',
    }),
    hidden: defineMessage({
        id: 'sidebar.splitterHidden',
        defaultMessage: 'Sidebar hidden',
        description: 'The splitter’s value while the sidebar is hidden; Enter shows it again.',
    }),
};

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

/** What a host's connection button does, as its accessible name (US-1.5). */
export const connectionActionMessages = {
    connect: defineMessage<{ host: string }>({
        id: 'host.action.connect',
        defaultMessage: 'Connect {host}',
        description: 'Accessible name of the connection button of a disconnected host.',
    }),
    disconnect: defineMessage<{ host: string }>({
        id: 'host.action.disconnect',
        defaultMessage: 'Disconnect {host}',
        description: 'Accessible name of the connection button of a connected host.',
    }),
    cancel: defineMessage<{ host: string }>({
        id: 'host.action.cancel',
        defaultMessage: 'Cancel connecting to {host}',
        description: 'Accessible name of the connection button while the host connects.',
    }),
    'review-key': defineMessage<{ host: string }>({
        id: 'host.action.reviewKey',
        defaultMessage: 'Review the host key of {host}',
        description: 'Accessible name of the connection button while a host key waits for the user.',
    }),
    retry: defineMessage<{ host: string }>({
        id: 'host.action.retry',
        defaultMessage: 'Reconnect {host} now',
        description: 'Accessible name of the connection button while the host waits to reconnect by itself.',
    }),
};

/** The connection button's name on a host whose connection failed (US-1.3, US-2.2.4). */
export const retryFailedMessage = defineMessage<{ host: string }>({
    id: 'host.action.retryFailed',
    defaultMessage: 'Retry connecting to {host}',
    description: 'Accessible name of the connection button of a host whose connection failed.',
});

/** The name of the action that a host's connection button runs, such as "Connect devbox-1". */
export function connectionActionMessage(action: ConnectionAction, status: ConnectionState['status']) {
    return action === 'connect' && status === 'failed' ? retryFailedMessage : connectionActionMessages[action];
}

/** A reconnecting host's state with why its last attempt failed, as the connection button's description. */
export const hostReconnectingMessage = defineMessage<{ details: string }>({
    id: 'host.reconnectingDetails',
    defaultMessage: 'Reconnecting. Last attempt: {details}',
    description: 'Description of a host that reconnects by itself, with what ssh or the host reported last time.',
});

/** A host's connection state with its failure, as the connection button's description. */
export const hostFailureMessage = defineMessage<{ details: string }>({
    id: 'host.failedDetails',
    defaultMessage: 'Connection failed: {details}',
    description: 'Description of a host whose connection failed, with what ssh or the host reported.',
});

/** The host-key question (US-1.2). */
export const hostKeyMessage = defineMessage<{ host: string; type: string; fingerprint: string }>({
    id: 'host.keyQuestion',
    defaultMessage: '{host} presented an unknown {type} host key, {fingerprint}. Trust it?',
    description: 'Question shown when a host presents a key the user has not trusted yet.',
});

/** The dialog that reports a failed connection (US-1.3). */
export const failureDialogMessages = {
    title: defineMessage<{ host: string }>({
        id: 'failure.title',
        defaultMessage: 'Couldn’t connect to {host}',
        description: 'Title of the dialog that reports a failed connection.',
    }),
    ...defineMessages({
        details: {
            id: 'failure.details',
            defaultMessage: 'Details',
            description: 'Label of the read-only field with what ssh or the host reported.',
        },
        ok: {
            id: 'failure.ok',
            defaultMessage: 'OK',
            description: 'Button that closes the failed-connection dialog.',
        },
    }),
};

/** A terminal's accessible name while its host is not connected (US-1.14.1). */
export const terminalDisconnectedMessage = defineMessage<{ session: string; host: string }>({
    id: 'terminal.labelDisconnected',
    defaultMessage: '{session}, {host}, disconnected',
    description: 'Accessible name of a terminal whose host is not connected.',
});

/** A terminal's accessible name while its host reconnects (US-2.2.2). */
export const terminalReconnectingMessage = defineMessage<{ session: string; host: string }>({
    id: 'terminal.labelReconnecting',
    defaultMessage: '{session}, {host}, reconnecting',
    description: 'Accessible name of a terminal whose host reconnects by itself.',
});

/** Review mode's accessible name, naming the session and host (A11Y-03). */
export const terminalReviewMessage = defineMessage<{ session: string; host: string }>({
    id: 'terminal.review',
    defaultMessage: 'Review {session}, {host}',
    description: 'Name of review mode, the read-only text field holding the whole buffer.',
});

/** The warning before the first session on a host that ends its sessions at logout (US-2.4.4). */
export const logoutWarningMessages = {
    title: defineMessage<{ host: string }>({
        id: 'logoutWarning.title',
        defaultMessage: 'Programs on {host} end when you disconnect',
        description: 'Title of the warning before the first session on a host that ends sessions at logout.',
    }),
    body: defineMessage<{ host: string }>({
        id: 'logoutWarning.body',
        defaultMessage:
            '{host} ends your processes when your last connection to it closes, and lingering is off for your user, so the programs in its sessions end when TRC’s connection closes. TRC brings the sessions back below their saved scrollback the next time it connects, each in a new shell. To keep programs running, ask the host’s administrator to enable lingering for your user (loginctl enable-linger).',
        description: 'Why the sessions end and what keeps them.',
    }),
    create: defineMessage({
        id: 'logoutWarning.create',
        defaultMessage: 'Create Session',
        description: 'Button that creates the session anyway.',
    }),
    cancel: defineMessage({
        id: 'logoutWarning.cancel',
        defaultMessage: 'Cancel',
        description: 'Button that creates no session.',
    }),
};
