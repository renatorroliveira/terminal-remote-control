import type { IntlShape, MessageDescriptor } from 'react-intl';
import { type CommandId, formatChord, type Keymap } from '../../../shared/keymap';
import { commandMessages } from '../shell-messages';
import type { HelpContext } from './help-context';
import { helpMessages, helpKeyMessages as keys } from './help-messages';

/** One shortcut in accessibility help. */
export interface HelpEntry {
    readonly action: string;
    readonly keys: string;
}

/** A table of shortcuts for one context. */
export interface HelpSection {
    readonly context: HelpContext;
    readonly title: string;
    readonly entries: readonly HelpEntry[];
}

type Topic = CommandId | { readonly action: MessageDescriptor; readonly keys: string | MessageDescriptor };

const TOPICS: Readonly<Record<HelpContext, readonly Topic[]>> = {
    terminal: [
        'review.toggle',
        'terminal.find',
        'terminal.listLinks',
        { action: keys.openLink, keys: 'Cmd+click' },
        { action: keys.copy, keys: 'Cmd+C' },
        { action: keys.paste, keys: 'Cmd+V' },
        { action: keys.scrollPage, keys: 'Shift+Page Up, Shift+Page Down' },
        { action: keys.contextMenu, keys: 'Shift+F10' },
        'terminal.toggleTabFocus',
        'terminal.sendNextKey',
        'announcements.toggleMute',
        'terminal.zoomIn',
        'terminal.zoomOut',
        'terminal.zoomReset',
    ],
    review: [
        { action: keys.readLines, keys: 'Up, Down' },
        { action: keys.bufferStart, keys: 'Cmd+Up' },
        { action: keys.bufferEnd, keys: 'Cmd+Down' },
        { action: keys.select, keys: 'Shift+Up, Shift+Down, Shift+Left, Shift+Right' },
        { action: keys.copy, keys: 'Cmd+C' },
        'terminal.find',
        { action: keys.closeReview, keys: 'Escape' },
        'review.toggle',
    ],
    sessions: [
        { action: keys.moveRows, keys: 'Up, Down' },
        { action: keys.collapse, keys: 'Left, Right' },
        { action: keys.firstLast, keys: 'Home, End' },
        { action: keys.typeAhead, keys: keys.typeAheadKeys },
        { action: keys.openSession, keys: 'Return' },
        { action: keys.contextMenu, keys: 'Shift+F10' },
        'session.newWithOptions',
    ],
    general: [
        'region.next',
        'region.previous',
        'palette.show',
        'sidebar.toggle',
        'session.new',
        'session.next',
        'session.previous',
        'notifications.show',
        'help.accessibility',
    ],
};

/**
 * The shortcuts accessibility help lists for `context`: its own first, then those that work everywhere. Commands
 * show the chord the keymap binds, so a rebound command shows its new chord; one without a chord is left out.
 */
export function helpSections(context: HelpContext, keymap: Keymap, intl: IntlShape): readonly HelpSection[] {
    const contexts: readonly HelpContext[] = context === 'general' ? ['general'] : [context, 'general'];
    return contexts.map((shown) => ({
        context: shown,
        title: intl.formatMessage(helpMessages[shown]),
        entries: TOPICS[shown].flatMap((topic) => entryFor(topic, keymap, intl)),
    }));
}

function entryFor(topic: Topic, keymap: Keymap, intl: IntlShape): readonly HelpEntry[] {
    if (typeof topic !== 'string') {
        const text = typeof topic.keys === 'string' ? topic.keys : intl.formatMessage(topic.keys);
        return [{ action: intl.formatMessage(topic.action), keys: text }];
    }
    const chord = keymap.chordFor(topic);
    return chord === undefined
        ? []
        : [{ action: intl.formatMessage(commandMessages[topic]), keys: formatChord(chord) }];
}
