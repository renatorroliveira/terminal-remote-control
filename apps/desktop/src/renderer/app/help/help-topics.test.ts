import { createIntl } from 'react-intl';
import { describe, expect, it } from 'vitest';
import { resolveKeymap } from '../../../shared/keymap';
import { messagesFor } from '../../i18n/locale';
import { helpSections } from './help-topics';

const intl = createIntl({ locale: 'en', messages: messagesFor('en') });

function entry(sections: ReturnType<typeof helpSections>, action: string): string | undefined {
    return sections.flatMap((section) => section.entries).find((found) => found.action === action)?.keys;
}

describe('helpSections: the shortcuts accessibility help lists (A11Y-10.1)', () => {
    it('lists the context’s keys first, then those that work everywhere', () => {
        const sections = helpSections('review', resolveKeymap({}), intl);
        expect(sections.map((section) => section.title)).toEqual(['In review mode', 'Everywhere']);
        expect(entry(sections, 'Close review mode')).toBe('Escape');
        expect(entry(sections, 'Go to the start of the buffer')).toBe('Cmd+Up');
        expect(entry(sections, 'Show command palette')).toBe('Shift+Cmd+P');
    });

    it('shows the shortcut the user bound instead of the default', () => {
        const sections = helpSections('terminal', resolveKeymap({ 'terminal.find': 'Ctrl+Cmd+G' }), intl);
        expect(sections[0]?.title).toBe('In the terminal');
        expect(entry(sections, 'Find…')).toBe('Ctrl+Cmd+G');
        expect(entry(sections, 'Open the link under the pointer')).toBe('Cmd+click');
    });

    it('lists the session list’s keys, and only the general ones elsewhere', () => {
        const sessions = helpSections('sessions', resolveKeymap({}), intl);
        expect(sessions[0]?.title).toBe('In the session list');
        expect(entry(sessions, 'Open the session')).toBe('Return');
        expect(helpSections('general', resolveKeymap({}), intl).map((section) => section.title)).toEqual([
            'Everywhere',
        ]);
    });
});
