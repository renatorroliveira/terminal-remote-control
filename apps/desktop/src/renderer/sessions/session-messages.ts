import { defineMessage, defineMessages } from 'react-intl';

/** The session tree (US-1.6.4). */
export const treeMessages = defineMessages({
    label: { id: 'tree.label', defaultMessage: 'Sessions', description: 'Accessible name of the session tree.' },
    newOutput: {
        id: 'tree.newOutput',
        defaultMessage: 'new output',
        description: 'Badge of a session with output the user has not seen.',
    },
    bell: {
        id: 'tree.bell',
        defaultMessage: 'bell',
        description: 'Badge of a background session whose bell rang.',
    },
});

/** A host row's accessible name. */
export const hostRowMessage = defineMessage<{ host: string; state: string }>({
    id: 'tree.hostRow',
    defaultMessage: '{host}, {state}',
    description: 'Accessible name of a host in the session tree.',
});

/** A session row's accessible name, with its badge (US-1.6.4). */
export const sessionRowWithBadgeMessage = defineMessage<{ name: string; state: string; badge: string }>({
    id: 'tree.sessionRowBadge',
    defaultMessage: '{name}, {state}, {badge}',
    description: 'Accessible name of a session with a badge, such as new output.',
});

/** A session's actions in its context menu (US-1.10). */
export const sessionActionMessages = defineMessages({
    open: { id: 'session.action.open', defaultMessage: 'Open', description: 'Session action.' },
    rename: { id: 'session.action.rename', defaultMessage: 'Rename…', description: 'Session action.' },
    stop: { id: 'session.action.stop', defaultMessage: 'Stop', description: 'Session action.' },
    restart: { id: 'session.action.restart', defaultMessage: 'Restart', description: 'Session action.' },
    duplicate: { id: 'session.action.duplicate', defaultMessage: 'Duplicate', description: 'Session action.' },
    moveUp: { id: 'session.action.moveUp', defaultMessage: 'Move up', description: 'Session action.' },
    moveDown: { id: 'session.action.moveDown', defaultMessage: 'Move down', description: 'Session action.' },
    close: { id: 'session.action.close', defaultMessage: 'Close…', description: 'Session action.' },
});

/** The open session's actions in the command palette, naming the session. */
export const paletteSessionMessages = {
    rename: defineMessage<{ session: string }>({
        id: 'palette.session.rename',
        defaultMessage: 'Rename {session}…',
        description: 'Palette entry.',
    }),
    stop: defineMessage<{ session: string }>({
        id: 'palette.session.stop',
        defaultMessage: 'Stop {session}',
        description: 'Palette entry.',
    }),
    restart: defineMessage<{ session: string }>({
        id: 'palette.session.restart',
        defaultMessage: 'Restart {session}',
        description: 'Palette entry.',
    }),
    duplicate: defineMessage<{ session: string }>({
        id: 'palette.session.duplicate',
        defaultMessage: 'Duplicate {session}',
        description: 'Palette entry.',
    }),
    moveUp: defineMessage<{ session: string }>({
        id: 'palette.session.moveUp',
        defaultMessage: 'Move {session} up',
        description: 'Palette entry.',
    }),
    moveDown: defineMessage<{ session: string }>({
        id: 'palette.session.moveDown',
        defaultMessage: 'Move {session} down',
        description: 'Palette entry.',
    }),
    close: defineMessage<{ session: string }>({
        id: 'palette.session.close',
        defaultMessage: 'Close {session}…',
        description: 'Palette entry.',
    }),
};

/** The Rename dialog (US-1.10.1). */
export const renameMessages = {
    title: defineMessage<{ session: string }>({
        id: 'rename.title',
        defaultMessage: 'Rename {session}',
        description: 'Dialog title.',
    }),
    label: defineMessage({ id: 'rename.label', defaultMessage: 'Name', description: 'Field label.' }),
    hint: defineMessage({
        id: 'rename.hint',
        defaultMessage: 'Leave it empty to show the title the program sets.',
        description: 'Field instructions.',
    }),
    save: defineMessage({ id: 'rename.save', defaultMessage: 'Rename', description: 'Button.' }),
    cancel: defineMessage({ id: 'rename.cancel', defaultMessage: 'Cancel', description: 'Button.' }),
};

/** The Close confirmation (US-1.10.4, A11Y-11.9). */
export const closeMessages = {
    title: defineMessage<{ session: string }>({
        id: 'close.title',
        defaultMessage: 'Close {session}?',
        description: 'Confirmation title.',
    }),
    body: defineMessage<{ session: string; host: string }>({
        id: 'close.body',
        defaultMessage:
            'TRC stops {session} on {host} if it is running, then deletes the session and its scrollback. This can’t be undone.',
        description: 'Says what closing deletes.',
    }),
    confirm: defineMessage({ id: 'close.confirm', defaultMessage: 'Close session', description: 'Button.' }),
    cancel: defineMessage({ id: 'close.cancel', defaultMessage: 'Cancel', description: 'Button.' }),
};

/** The New session dialog (US-1.7.2). */
export const newSessionMessages = {
    title: defineMessage({ id: 'newSession.title', defaultMessage: 'New session', description: 'Dialog title.' }),
    host: defineMessage({ id: 'newSession.host', defaultMessage: 'Host', description: 'Field label.' }),
    profile: defineMessage({ id: 'newSession.profile', defaultMessage: 'Shell', description: 'Field label.' }),
    cwd: defineMessage({
        id: 'newSession.cwd',
        defaultMessage: 'Working folder (optional)',
        description: 'Field label.',
    }),
    cwdHint: defineMessage({
        id: 'newSession.cwdHint',
        defaultMessage: 'Your home folder when empty.',
        description: 'Field instructions.',
    }),
    name: defineMessage({ id: 'newSession.name', defaultMessage: 'Name (optional)', description: 'Field label.' }),
    env: defineMessage({
        id: 'newSession.env',
        defaultMessage: 'Environment (optional)',
        description: 'Field label.',
    }),
    envHint: defineMessage({
        id: 'newSession.envHint',
        defaultMessage: 'One NAME=value per line. NAME= with no value removes the variable.',
        description: 'Field instructions.',
    }),
    envInvalid: defineMessage({
        id: 'newSession.envInvalid',
        defaultMessage: 'Write each line as NAME=value, where NAME has only letters, digits and underscores.',
        description: 'Field error with its fix.',
    }),
    noHost: defineMessage({
        id: 'newSession.noHost',
        defaultMessage: 'Connect a host first.',
        description: 'Shown when no host is connected.',
    }),
    create: defineMessage({ id: 'newSession.create', defaultMessage: 'Create', description: 'Button.' }),
    cancel: defineMessage({ id: 'newSession.cancel', defaultMessage: 'Cancel', description: 'Button.' }),
};
