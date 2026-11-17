import type { EndCause, PersistenceFailure } from '@trc/protocol';
import { defineMessage, defineMessages } from 'react-intl';

/** The state of a session that stayed ended because its processes ended (US-3.1.8, P-41). */
export const endedMessages = defineMessages<EndCause>({
    hostRestart: {
        id: 'session.endedByRestart',
        defaultMessage: 'Ended by restart',
        description: 'Session state after a restart of its host ended its processes and it was not restored.',
    },
    processesEnded: {
        id: 'session.processesEnded',
        defaultMessage: 'Processes ended',
        description: 'Session state after its processes ended, such as at logout, and it was not restored.',
    },
    unspecified: {
        id: 'session.ended',
        defaultMessage: 'Ended',
        description: 'Session state after its processes ended for a reason this version does not know.',
    },
});

/** Why a session's scrollback cannot be saved (US-3.1.2). */
export const persistenceFailureMessages = defineMessages<PersistenceFailure>({
    diskFull: {
        id: 'persistence.diskFull',
        defaultMessage: 'the disk is full',
        description: 'Why scrollback cannot be saved: the host’s disk is full.',
    },
    quota: {
        id: 'persistence.quota',
        defaultMessage: 'your disk quota is used up',
        description: 'Why scrollback cannot be saved: the user’s disk quota on the host is used up.',
    },
    readOnly: {
        id: 'persistence.readOnly',
        defaultMessage: 'the file system is read-only',
        description: 'Why scrollback cannot be saved: the host’s file system is read-only.',
    },
    other: {
        id: 'persistence.other',
        defaultMessage: 'an error that the daemon’s log names',
        description: 'Why scrollback cannot be saved: another error, named in the daemon’s log.',
    },
    unspecified: {
        id: 'persistence.unspecified',
        defaultMessage: 'an unknown error',
        description: 'Why scrollback cannot be saved: a reason this version does not know.',
    },
});

/** A session whose scrollback cannot be saved, announced and listed once (US-3.1.2). */
export const persistenceFailedMessage = defineMessage<{ session: string; host: string; reason: string }>({
    id: 'announce.persistenceFailed',
    defaultMessage: 'Scrollback of {session} on {host} can’t be saved: {reason}.',
    description: 'Announced and listed when the daemon cannot save a session’s scrollback to disk.',
});

/** Sessions a host brought back after their processes ended, announced once per host and restore (P-42). */
export const restoreAnnouncements = {
    afterRestart: defineMessage<{ host: string; count: number }>({
        id: 'announce.restoredAfterRestart',
        defaultMessage: '{host} restarted: {count, plural, one {# session} other {# sessions}} restored.',
        description: 'Announced and listed when a host restarted and the daemon restored its sessions.',
    }),
    restored: defineMessage<{ host: string; count: number }>({
        id: 'announce.restored',
        defaultMessage: '{host}: {count, plural, one {# session} other {# sessions}} restored.',
        description: 'Announced and listed when the daemon restored sessions whose processes ended.',
    }),
};
