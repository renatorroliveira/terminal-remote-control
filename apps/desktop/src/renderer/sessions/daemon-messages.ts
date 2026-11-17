import { defineMessage, defineMessages } from 'react-intl';

/** What the app says while it manages a host's daemon (US-3.3.2, US-3.3.3, A11Y-12.2). */
export const daemonAnnouncements = {
    restarting: defineMessage<{ host: string }>({
        id: 'announce.daemonRestarting',
        defaultMessage: 'Restarting the daemon on {host}.',
        description: 'Announced when the user restarts a host’s daemon; its sessions keep running.',
    }),
    restarted: defineMessage<{ host: string }>({
        id: 'announce.daemonRestarted',
        defaultMessage: 'Daemon restarted on {host}.',
        description: 'Announced and listed once the host connects to its restarted daemon.',
    }),
    removing: defineMessage<{ host: string }>({
        id: 'announce.daemonRemoving',
        defaultMessage: 'Removing the daemon from {host}.',
        description: 'Announced when the user confirms Remove daemon from host.',
    }),
    removed: defineMessage<{ host: string }>({
        id: 'announce.daemonRemoved',
        defaultMessage: 'Daemon removed from {host}.',
        description: 'Announced and listed once the daemon and everything TRC wrote on the host are deleted.',
    }),
    removedKept: defineMessage<{ host: string; root: string; count: number }>({
        id: 'announce.daemonRemovedKept',
        defaultMessage:
            'Daemon removed from {host}. {root} keeps {count, plural, one {# item} other {# items}} TRC did not write.',
        description: 'Announced and listed when the install location holds other files, which stay.',
    }),
    removeFailed: defineMessage<{ host: string; problem: string }>({
        id: 'announce.daemonRemoveFailed',
        defaultMessage: 'Couldn’t remove the daemon from {host}. {problem}',
        description: 'Announced and listed when removing the daemon fails.',
    }),
};

/** The Details dialog of a host and its daemon (US-3.3.1). */
export const detailsMessages = {
    title: defineMessage<{ host: string }>({
        id: 'details.title',
        defaultMessage: 'Details of {host}',
        description: 'Title of the dialog about a host and its daemon.',
    }),
    connection: defineMessage({ id: 'details.connection', defaultMessage: 'Connection', description: 'Label.' }),
    version: defineMessage({ id: 'details.version', defaultMessage: 'Daemon version', description: 'Label.' }),
    uptime: defineMessage({ id: 'details.uptime', defaultMessage: 'Running for', description: 'Label.' }),
    service: defineMessage({
        id: 'details.service',
        defaultMessage: 'Runs',
        description: 'Label: how the daemon runs.',
    }),
    installRoot: defineMessage({
        id: 'details.installRoot',
        defaultMessage: 'Install location',
        description: 'Label of the read-only field holding the daemon’s install location.',
    }),
    logs: defineMessage({
        id: 'details.logs',
        defaultMessage: 'Logs',
        description: 'Label of the read-only field holding the folder of the daemon’s logs.',
    }),
    notConnected: defineMessage({
        id: 'details.notConnected',
        defaultMessage: 'Connect to see the daemon’s version, uptime and logs.',
        description: 'Shown in the details of a host that is not connected.',
    }),
    systemd: defineMessage({
        id: 'details.systemd',
        defaultMessage: 'As a systemd user service',
        description: 'How the daemon runs: under the user’s systemd instance.',
    }),
    launchd: defineMessage({
        id: 'details.launchd',
        defaultMessage: 'As a LaunchAgent, which starts at login',
        description: 'How the daemon runs: as a macOS launchd LaunchAgent, which starts it at login.',
    }),
    detached: defineMessage({
        id: 'details.detached',
        defaultMessage: 'On its own, outside any service manager',
        description: 'How the daemon runs: detached from the service manager.',
    }),
    unknownService: defineMessage({
        id: 'details.unknownService',
        defaultMessage: 'In a way this version does not know',
        description: 'How the daemon runs, when it says something this app does not know.',
    }),
    lessThanAMinute: defineMessage({
        id: 'details.lessThanAMinute',
        defaultMessage: 'Less than a minute',
        description: 'The daemon’s uptime when it started a moment ago.',
    }),
    upgrade: defineMessage({ id: 'details.upgrade', defaultMessage: 'Upgrade daemon', description: 'Button.' }),
    upgradeHint: defineMessage<{ version: string }>({
        id: 'details.upgradeHint',
        defaultMessage: 'This app brings daemon {version}. Upgrading keeps every session.',
        description: 'Why Upgrade daemon shows: the host runs an older daemon.',
    }),
    upToDate: defineMessage({
        id: 'details.upToDate',
        defaultMessage: 'Up to date: the host runs the daemon this app brings.',
        description: 'Why Upgrade daemon does not show (P-43).',
    }),
    restart: defineMessage({ id: 'details.restart', defaultMessage: 'Restart daemon', description: 'Button.' }),
    remove: defineMessage({
        id: 'details.remove',
        defaultMessage: 'Remove daemon from host…',
        description: 'Button that asks for confirmation first.',
    }),
    close: defineMessage({ id: 'details.close', defaultMessage: 'Close', description: 'Button.' }),
    saving: defineMessage({ id: 'details.saving', defaultMessage: 'Saving scrollback', description: 'Label.' }),
    savingFails: defineMessage<{ count: number; reason: string }>({
        id: 'details.savingFails',
        defaultMessage: 'Fails for {count, plural, one {# session} other {# sessions}}: {reason}',
        description: 'The daemon cannot save the scrollback of some sessions (US-3.1.2).',
    }),
};

/** The confirmation before Remove daemon from host (US-3.3.3, WCAG 3.3.4). */
export const removeMessages = {
    title: defineMessage<{ host: string }>({
        id: 'removeDaemon.title',
        defaultMessage: 'Remove the daemon from {host}?',
        description: 'Title of the confirmation before removing a host’s daemon.',
    }),
    sessions: defineMessage<{ count: number }>({
        id: 'removeDaemon.sessions',
        defaultMessage:
            '{count, plural, =0 {No session runs there.} one {This session stops:} other {These # sessions stop:}}',
        description: 'Introduces the list of sessions that removing the daemon stops.',
    }),
    data: defineMessage<{ root: string; host: string }>({
        id: 'removeDaemon.data',
        defaultMessage:
            'It deletes the daemon’s programs, every session’s saved scrollback and its logs from {root} on {host}; other files there stay. {host} then stays in the app, not connected, until you connect it, which installs the daemon again.',
        description: 'What removing the daemon deletes, and what happens to the host.',
    }),
    cancel: defineMessage({ id: 'removeDaemon.cancel', defaultMessage: 'Cancel', description: 'Button.' }),
    confirm: defineMessage({ id: 'removeDaemon.confirm', defaultMessage: 'Remove daemon', description: 'Button.' }),
};
