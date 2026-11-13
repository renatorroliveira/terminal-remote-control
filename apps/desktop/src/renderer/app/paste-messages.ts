import { defineMessage } from 'react-intl';

/** The paste confirmation (US-1.12.2). */
export const pasteMessages = {
    title: defineMessage<{ lines: number }>({
        id: 'paste.title',
        defaultMessage: '{lines, plural, one {Paste # line?} other {Paste # lines?}}',
        description: 'Title of the confirmation before a paste of more than one line.',
    }),
    body: defineMessage({
        id: 'paste.body',
        defaultMessage: 'TRC types the text into the terminal, and the shell may run each line as a command.',
        description: 'Says what pasting several lines does.',
    }),
    preview: defineMessage({ id: 'paste.preview', defaultMessage: 'Text to paste', description: 'Field label.' }),
    paste: defineMessage({ id: 'paste.paste', defaultMessage: 'Paste', description: 'Button.' }),
    cancel: defineMessage({ id: 'paste.cancel', defaultMessage: 'Cancel', description: 'Button.' }),
};

/** A copy past the selection cap (A11Y-04.7). */
export const copyCappedMessage = defineMessage<{ lines: number; cap: number }>({
    id: 'copy.capped',
    defaultMessage: 'Copied all {lines, number} lines. Assistive technology sees the first {cap, number}.',
    description: 'Announced after a copy of more lines than the OS sees selected.',
});
