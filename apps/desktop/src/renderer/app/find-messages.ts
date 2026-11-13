import { defineMessage } from 'react-intl';

/** The find bar (US-1.13). */
export const findBarMessages = {
    region: defineMessage({ id: 'find.region', defaultMessage: 'Find in terminal', description: 'Search landmark.' }),
    field: defineMessage({ id: 'find.field', defaultMessage: 'Find', description: 'Search field label.' }),
    hint: defineMessage({
        id: 'find.hint',
        defaultMessage: 'Return finds the previous match, Shift-Return the next, Escape closes.',
        description: 'Instructions under the find field.',
    }),
    invalid: defineMessage({
        id: 'find.invalid',
        defaultMessage: 'Not a valid regular expression.',
        description: 'Field error.',
    }),
    matchCase: defineMessage({ id: 'find.matchCase', defaultMessage: 'Match case', description: 'Toggle button.' }),
    regex: defineMessage({ id: 'find.regex', defaultMessage: 'Regular expression', description: 'Toggle button.' }),
    previous: defineMessage({ id: 'find.previous', defaultMessage: 'Previous match', description: 'Button.' }),
    next: defineMessage({ id: 'find.next', defaultMessage: 'Next match', description: 'Button.' }),
    close: defineMessage({ id: 'find.close', defaultMessage: 'Close find', description: 'Button.' }),
    count: defineMessage<{ index: number; count: number }>({
        id: 'find.count',
        defaultMessage: '{index, number} of {count, number}',
        description: 'Which match of how many is selected.',
    }),
    none: defineMessage({ id: 'find.none', defaultMessage: 'No matches', description: 'Shown when nothing matches.' }),
};
