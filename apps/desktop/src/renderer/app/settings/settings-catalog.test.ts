import { createIntl } from 'react-intl';
import { describe, expect, it } from 'vitest';
import { messagesFor } from '../../i18n/locale';
import { SETTING_ENTRIES, settingsMatching } from './settings-catalog';

const intl = createIntl({ locale: 'en', messages: messagesFor('en') });

function ids(query: string): string[] {
    return settingsMatching(SETTING_ENTRIES, query, intl).map((entry) => entry.id);
}

describe('settingsMatching: the settings page’s search (A11Y-10.3)', () => {
    it('shows every setting for an empty search', () => {
        expect(ids('  ')).toHaveLength(SETTING_ENTRIES.length);
    });

    it('matches labels and descriptions without regard to case or accents', () => {
        expect(ids('SCROLLBACK')).toEqual(['scrollbackLines']);
        expect(ids('voiceover')).toEqual(['screenReaderMode', 'hints']);
        expect(ids('cürsor')).toEqual(['cursorStyle', 'cursorWidth', 'cursorBlink']);
    });

    it('shows a whole section when its title matches', () => {
        expect(ids('hosts')).toEqual(['clipboardWrites']);
        expect(ids('keyboard')).toEqual(['tabFocusMode', 'plainF6', 'shortcuts']);
    });
});
