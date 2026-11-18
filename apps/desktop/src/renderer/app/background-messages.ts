import { defineMessage, defineMessages } from 'react-intl';

/** An event in a session that isn't open, announced as in US-5.3.1's example. */
export const backgroundEventMessage = defineMessage<{ session: string; host: string; event: string }>({
    id: 'announce.backgroundEvent',
    defaultMessage: 'Session {session} on {host}: {event}.',
    description: 'An event in a session that is not open, such as “Session build on devbox-1: bell.” (US-5.3.1).',
});

/** An OS notification's title: the session and its host. */
export const backgroundNoticeTitle = defineMessage<{ session: string; host: string }>({
    id: 'notice.backgroundTitle',
    defaultMessage: '{session} on {host}',
    description: 'Title of an OS notification of an event in a session that is not open (US-5.3.1).',
});

/** What happened, as the end of an announcement and as an OS notification's body. */
export const backgroundEventMessages = defineMessages({
    bell: { id: 'background.bell', defaultMessage: 'bell', description: 'The session’s program rang the bell.' },
    ended: { id: 'background.ended', defaultMessage: 'ended', description: 'The session’s process ended.' },
    endedWithCode: defineMessage<{ code: number }>({
        id: 'background.endedWithCode',
        defaultMessage: 'ended, exit code {code}',
        description: 'The session’s process ended with an exit code.',
    }),
    command: {
        id: 'background.command',
        defaultMessage: 'command finished',
        description: 'A long command finished, as shell integration marked it.',
    },
    commandWithCode: defineMessage<{ code: number }>({
        id: 'background.commandWithCode',
        defaultMessage: 'command finished, exit code {code}',
        description: 'A long command finished with an exit code (US-5.3.1’s example).',
    }),
});

/** An OS notification's body: what happened, as a sentence. */
export const backgroundNoticeBodies = defineMessages({
    bell: { id: 'notice.bell', defaultMessage: 'Bell.', description: 'OS notification body: the bell rang.' },
    ended: { id: 'notice.ended', defaultMessage: 'Ended.', description: 'OS notification body: the process ended.' },
    endedWithCode: defineMessage<{ code: number }>({
        id: 'notice.endedWithCode',
        defaultMessage: 'Ended, exit code {code}.',
        description: 'OS notification body: the process ended with an exit code.',
    }),
    command: {
        id: 'notice.command',
        defaultMessage: 'Command finished.',
        description: 'OS notification body: a long command finished.',
    },
    commandWithCode: defineMessage<{ code: number }>({
        id: 'notice.commandWithCode',
        defaultMessage: 'Command finished, exit code {code}.',
        description: 'OS notification body: a long command finished with an exit code.',
    }),
});
