import { defineMessages } from 'react-intl';

/** The accessibility help dialog (A11Y-10.1). */
export const helpMessages = defineMessages({
    title: { id: 'help.title', defaultMessage: 'Accessibility help', description: 'Title of the help dialog.' },
    intro: {
        id: 'help.intro',
        defaultMessage: 'Shortcuts for where you are, then those that work everywhere.',
        description: 'First paragraph of the help dialog.',
    },
    terminal: { id: 'help.terminal', defaultMessage: 'In the terminal', description: 'Help section title.' },
    review: { id: 'help.review', defaultMessage: 'In review mode', description: 'Help section title.' },
    sessions: { id: 'help.sessions', defaultMessage: 'In the session list', description: 'Help section title.' },
    general: { id: 'help.general', defaultMessage: 'Everywhere', description: 'Help section title.' },
    action: { id: 'help.action', defaultMessage: 'Action', description: 'Column header in the help tables.' },
    keys: { id: 'help.keys', defaultMessage: 'Keys', description: 'Column header in the help tables.' },
    documentation: {
        id: 'help.documentation',
        defaultMessage: 'Documentation',
        description: 'Heading above the buttons that open the user guide.',
    },
    voiceOver: {
        id: 'help.voiceOver',
        defaultMessage: 'VoiceOver quick start',
        description: 'Button that opens the user guide at its VoiceOver quick start.',
    },
    close: { id: 'help.close', defaultMessage: 'Close', description: 'Button that closes the help dialog.' },
});

/** The keys of each context that are not app commands, so they are not rebindable. */
export const helpKeyMessages = defineMessages({
    scrollPage: {
        id: 'help.key.scrollPage',
        defaultMessage: 'Scroll a page up or down',
        description: 'Help entry in the terminal.',
    },
    contextMenu: {
        id: 'help.key.contextMenu',
        defaultMessage: 'Show the actions menu',
        description: 'Help entry: opens the context menu.',
    },
    openLink: {
        id: 'help.key.openLink',
        defaultMessage: 'Open the link under the pointer',
        description: 'Help entry in the terminal.',
    },
    copy: { id: 'help.key.copy', defaultMessage: 'Copy the selection', description: 'Help entry.' },
    paste: { id: 'help.key.paste', defaultMessage: 'Paste', description: 'Help entry in the terminal.' },
    readLines: {
        id: 'help.key.readLines',
        defaultMessage: 'Read the previous or next line',
        description: 'Help entry in review mode.',
    },
    bufferStart: {
        id: 'help.key.bufferStart',
        defaultMessage: 'Go to the start of the buffer',
        description: 'Help entry in review mode.',
    },
    bufferEnd: {
        id: 'help.key.bufferEnd',
        defaultMessage: 'Go to the end of the buffer',
        description: 'Help entry in review mode.',
    },
    select: {
        id: 'help.key.select',
        defaultMessage: 'Select text',
        description: 'Help entry in review mode.',
    },
    closeReview: {
        id: 'help.key.closeReview',
        defaultMessage: 'Close review mode',
        description: 'Help entry in review mode.',
    },
    moveRows: {
        id: 'help.key.moveRows',
        defaultMessage: 'Move between hosts and sessions',
        description: 'Help entry in the session list.',
    },
    collapse: {
        id: 'help.key.collapse',
        defaultMessage: 'Collapse or expand a host',
        description: 'Help entry in the session list.',
    },
    firstLast: {
        id: 'help.key.firstLast',
        defaultMessage: 'Go to the first or last row',
        description: 'Help entry in the session list.',
    },
    typeAhead: {
        id: 'help.key.typeAhead',
        defaultMessage: 'Go to a session by name',
        description: 'Help entry in the session list.',
    },
    typeAheadKeys: {
        id: 'help.key.typeAheadKeys',
        defaultMessage: 'Type its first letters',
        description: 'The keys of the type-ahead help entry.',
    },
    openSession: {
        id: 'help.key.openSession',
        defaultMessage: 'Open the session',
        description: 'Help entry in the session list.',
    },
});
