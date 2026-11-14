import { defineMessage, defineMessages } from 'react-intl';

/** The first-quit notice (US-2.1.5, P-26). */
export const firstQuitMessages = defineMessages({
    title: {
        id: 'quit.first.title',
        defaultMessage: 'Your sessions keep running',
        description: 'Title of the dialog shown the first time the user quits while sessions run.',
    },
    body: {
        id: 'quit.first.body',
        defaultMessage:
            'Sessions keep running on their hosts after TRC quits, and TRC reconnects to them when it opens again. To end them, choose Quit and Stop All Sessions, here or in the TRC menu. This message won’t appear again.',
        description: 'Text of the first-quit dialog.',
    },
    quit: {
        id: 'quit.first.quit',
        defaultMessage: 'Quit',
        description: 'Button that quits and leaves sessions running.',
    },
    stopAll: {
        id: 'quit.first.stopAll',
        defaultMessage: 'Quit and Stop All Sessions…',
        description: 'Button that asks to stop every session, then quits.',
    },
    cancel: { id: 'quit.first.cancel', defaultMessage: 'Cancel', description: 'Button that keeps the app open.' },
});

/** The confirmation of Quit and Stop All Sessions (US-2.1.4). */
export const stopAllMessages = {
    title: defineMessage({
        id: 'quit.stopAll.title',
        defaultMessage: 'Stop all sessions and quit?',
        description: 'Title of the confirmation before stopping every session.',
    }),
    body: defineMessage<{ sessions: number; hosts: number }>({
        id: 'quit.stopAll.body',
        defaultMessage:
            '{sessions, plural, =0 {No session runs on a connected host.} one {# session on {hosts, plural, one {# host} other {# hosts}} will stop: its program ends, and its scrollback stays until you close it.} other {# sessions on {hosts, plural, one {# host} other {# hosts}} will stop: their programs end, and their scrollback stays until you close them.}}',
        description: 'What stopping every session does, with the counts.',
    }),
    unreachable: defineMessage<{ hosts: string }>({
        id: 'quit.stopAll.unreachable',
        defaultMessage: 'Not connected, so its sessions keep running: {hosts}.',
        description: 'Names the hosts TRC cannot reach, whose sessions it cannot stop.',
    }),
    confirm: defineMessage({
        id: 'quit.stopAll.confirm',
        defaultMessage: 'Stop Sessions and Quit',
        description: 'Button that stops every session and quits.',
    }),
    stopping: defineMessage({
        id: 'quit.stopAll.stopping',
        defaultMessage: 'Stopping…',
        description: 'The confirm button while the sessions stop.',
    }),
    cancel: defineMessage({
        id: 'quit.stopAll.cancel',
        defaultMessage: 'Cancel',
        description: 'Button that keeps the app open.',
    }),
};

/** Announced and listed when a host refused to stop its sessions (WCAG 3.3.1). */
export const stopAllFailedMessage = defineMessage<{ hosts: string }>({
    id: 'quit.stopAll.failed',
    defaultMessage: 'Couldn’t stop the sessions on {hosts}. TRC is still open.',
    description: 'Reported when Quit and Stop All Sessions could not stop every session.',
});
