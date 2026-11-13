import type { IntlShape, MessageDescriptor } from 'react-intl';
import { settingDescriptionMessages, settingGroupMessages, settingLabelMessages } from './settings-messages';

/** The settings page's sections, in order. */
export const SETTING_GROUPS = ['speech', 'display', 'keyboard', 'sessions', 'hosts'] as const;

/** One section of the settings page. */
export type SettingGroup = (typeof SETTING_GROUPS)[number];

/** One setting on the page. */
export type SettingId = keyof typeof settingLabelMessages;

/** A setting: its section, label and, for some, a description the search also reads. */
export interface SettingEntry {
    readonly id: SettingId;
    readonly group: SettingGroup;
    readonly label: MessageDescriptor;
    readonly description: MessageDescriptor | undefined;
}

const GROUP_OF: Readonly<Record<SettingId, SettingGroup>> = {
    screenReaderMode: 'speech',
    verbosity: 'speech',
    hints: 'speech',
    floodThreshold: 'speech',
    theme: 'display',
    minimumContrast: 'display',
    terminalZoom: 'display',
    lineHeight: 'display',
    letterSpacing: 'display',
    cursorStyle: 'display',
    cursorWidth: 'display',
    cursorBlink: 'display',
    tabFocusMode: 'keyboard',
    newSessionFolder: 'sessions',
    scrollbackLines: 'sessions',
    stopGraceSeconds: 'sessions',
    autoClose: 'sessions',
    pasteConfirmation: 'sessions',
    clipboardWrites: 'hosts',
};

const DESCRIPTIONS: Readonly<Partial<Record<SettingId, MessageDescriptor>>> = settingDescriptionMessages;

/** Every setting, in page order (A11Y-10.3). */
export const SETTING_ENTRIES: readonly SettingEntry[] = (Object.keys(GROUP_OF) as SettingId[]).map((id) => ({
    id,
    group: GROUP_OF[id],
    label: settingLabelMessages[id],
    description: DESCRIPTIONS[id],
}));

/**
 * The settings a search shows: those whose label or description holds the query, ignoring case and accents, and
 * every setting of a section whose title holds it. An empty search shows them all.
 */
export function settingsMatching(
    entries: readonly SettingEntry[],
    query: string,
    intl: IntlShape,
): readonly SettingEntry[] {
    const wanted = searchable(query.trim());
    if (wanted === '') {
        return entries;
    }
    const holds = (message: MessageDescriptor | undefined): boolean =>
        message !== undefined && searchable(intl.formatMessage(message)).includes(wanted);
    return entries.filter(
        (entry) => holds(entry.label) || holds(entry.description) || holds(settingGroupMessages[entry.group]),
    );
}

function searchable(text: string): string {
    return text
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase();
}
