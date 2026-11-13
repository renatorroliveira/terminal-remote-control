import { defineMessage, defineMessages } from 'react-intl';

/** What the shell says about links (US-1.12.3). */
export const linkAnnouncements = defineMessages({
    refused: {
        id: 'link.refused',
        defaultMessage: 'TRC doesn’t open this kind of link.',
        description: 'Announced for a link TRC never opens, such as a javascript: link.',
    },
    none: {
        id: 'link.none',
        defaultMessage: 'No links on the screen.',
        description: 'Announced when List links finds no link.',
    },
});

/** The link confirmation (US-1.12.4). */
export const confirmLinkMessages = {
    title: defineMessage({ id: 'link.confirm.title', defaultMessage: 'Open this link?', description: 'Dialog title.' }),
    check: defineMessage({
        id: 'link.confirm.check',
        defaultMessage: 'A program in the terminal printed this link. Check its address before you open it.',
        description: 'Dialog text for a link whose text is its address.',
    }),
    differs: defineMessage<{ text: string }>({
        id: 'link.confirm.differs',
        defaultMessage: 'The link shows “{text}”, but it opens the address below. Check it before you open it.',
        description: 'Dialog text for a link whose text hides a different address.',
    }),
    address: defineMessage({
        id: 'link.confirm.address',
        defaultMessage: 'Address',
        description: 'Label of the read-only field holding the link target.',
    }),
    trustHint: defineMessage<{ origin: string }>({
        id: 'link.confirm.trustHint',
        defaultMessage:
            'Always open links that start with {origin} opens them without asking from now on. accept_urls.json in the TRC home folder keeps the list.',
        description: 'Explains the Always open button.',
    }),
    open: defineMessage({ id: 'link.confirm.open', defaultMessage: 'Open', description: 'Button.' }),
    trust: defineMessage<{ origin: string }>({
        id: 'link.confirm.trust',
        defaultMessage: 'Always open links that start with {origin}',
        description: 'Button that trusts the link’s origin, then opens the link.',
    }),
    cancel: defineMessage({ id: 'link.confirm.cancel', defaultMessage: 'Cancel', description: 'Button.' }),
};

/** The List links dialog (US-1.12.3). */
export const linkListMessages = {
    title: defineMessage({
        id: 'link.list.title',
        defaultMessage: 'Links on the screen',
        description: 'Dialog title.',
    }),
    list: defineMessage({ id: 'link.list.label', defaultMessage: 'Links', description: 'List name.' }),
    close: defineMessage({ id: 'link.list.close', defaultMessage: 'Close', description: 'Button.' }),
};
