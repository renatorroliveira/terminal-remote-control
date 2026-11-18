import { defineMessage } from 'react-intl';

/** The quick switcher (US-5.4). */
export const switcherMessages = {
    title: defineMessage({ id: 'switcher.title', defaultMessage: 'Go to session', description: 'Dialog name.' }),
    search: defineMessage({
        id: 'switcher.search',
        defaultMessage: 'Session name, host or title',
        description: 'Search field label of the quick switcher.',
    }),
    count: defineMessage<{ count: number }>({
        id: 'switcher.count',
        defaultMessage: '{count, plural, =0 {No session matches.} one {# session.} other {# sessions.}}',
        description: 'How many sessions the quick switcher shows, announced as the user types (US-5.4.1).',
    }),
    entry: defineMessage<{ session: string; host: string; state: string }>({
        id: 'switcher.entry',
        defaultMessage: '{session}, {host}, {state}',
        description: 'One session in the quick switcher: its name, its host and its state.',
    }),
};
