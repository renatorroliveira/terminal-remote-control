import { defineMessages } from 'react-intl';

/** The app shell's UI strings (NFR-13). Extracted to `lang/en.json` and precompiled by `pnpm i18n`. */
export const shellMessages = defineMessages({
    noSession: {
        id: 'shell.noSession',
        defaultMessage: 'No session is open.',
        description: 'Shown in the terminal area while no session is open.',
    },
});
