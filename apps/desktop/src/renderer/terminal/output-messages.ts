import { defineMessage } from 'react-intl';

/** What is spoken instead of the lines when output comes faster than speech (A11Y-02.3). */
export const floodMessage = defineMessage<{ lines: number }>({
    id: 'output.flood',
    defaultMessage: '{lines, plural, one {# line} other {# lines}} of output',
    description: 'Spoken once a flood of output pauses; the full text stays in review mode.',
});
