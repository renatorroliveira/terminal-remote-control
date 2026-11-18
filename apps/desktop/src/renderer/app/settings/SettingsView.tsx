import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
import { Button, Input, Label, SearchField } from 'react-aria-components';
import { useIntl } from 'react-intl';
import type { WorkspaceController } from '../../sessions/workspace-controller';
import { BUTTON, PRIMARY_BUTTON } from '../../ui/buttons';
import type { Shell } from '../shell';
import { SettingControl } from './SettingControl';
import styles from './SettingsView.module.css';
import {
    SETTING_ENTRIES,
    SETTING_GROUPS,
    SETTINGS_SEARCH_ATTRIBUTE,
    type SettingEntry,
    type SettingGroup,
    settingsMatching,
} from './settings-catalog';
import { settingGroupMessages, settingsPageMessages } from './settings-messages';
import type { SettingsStore } from './settings-store';

/** What the settings view edits. */
export interface SettingsViewProps {
    readonly shell: Shell;
    readonly settings: SettingsStore;
    readonly workspace: WorkspaceController;
}

/**
 * The settings (A11Y-10.3, US-1.6.7, P-72), shown in the terminal's place: a list of sections with the search above
 * it, and the chosen section beside them; a search shows the matching settings of every section and says how many.
 * Controls apply each change at once. Escape, when no control takes it, goes back to where focus was.
 */
export function SettingsView({ shell, settings, workspace }: SettingsViewProps) {
    const intl = useIntl();
    const [query, setQuery] = useState('');
    const [section, setSection] = useState<SettingGroup>('appearance');
    const available = SETTING_ENTRIES.filter(
        (entry) => entry.id !== 'screenReaderMode' || shell.screenReaderMode !== undefined,
    );
    const shown = settingsMatching(available, query, intl);
    const groups = query.trim() === '' ? [section] : SETTING_GROUPS;
    const choose = (group: SettingGroup): void => {
        setQuery('');
        setSection(group);
    };
    const view = useRef<HTMLElement>(null);
    useEscape(view, () => shell.closeSettings());
    return (
        <section ref={view} aria-labelledby="trc-settings-title" className={styles['view']}>
            <div className={styles['frame']}>
                <nav aria-label={intl.formatMessage(settingsPageMessages.sections)} className={styles['nav']}>
                    <h2 id="trc-settings-title" className={styles['heading']}>
                        {intl.formatMessage(settingsPageMessages.title)}
                    </h2>
                    <SearchField value={query} onChange={setQuery} autoFocus className={styles['search'] ?? ''}>
                        <Label>{intl.formatMessage(settingsPageMessages.search)}</Label>
                        <Input {...{ [SETTINGS_SEARCH_ATTRIBUTE]: '' }} className={styles['input'] ?? ''} />
                    </SearchField>
                    <p role="status" className={styles['status']}>
                        {shown.length === 0
                            ? intl.formatMessage(settingsPageMessages.none)
                            : intl.formatMessage(settingsPageMessages.shown, {
                                  shown: shown.length,
                                  total: available.length,
                              })}
                    </p>
                    <SectionList current={query.trim() === '' ? section : undefined} onChoose={choose} />
                    <Button className={PRIMARY_BUTTON} onPress={() => shell.closeSettings()}>
                        {intl.formatMessage(settingsPageMessages.close)}
                    </Button>
                </nav>
                <div className={styles['content']}>
                    {groups.map((group) => (
                        <SettingsSection
                            key={group}
                            group={group}
                            entries={shown.filter((entry) => entry.group === group)}
                        >
                            {(entry) => (
                                <SettingControl
                                    key={entry.id}
                                    id={entry.id}
                                    shell={shell}
                                    settings={settings}
                                    workspace={workspace}
                                />
                            )}
                        </SettingsSection>
                    ))}
                </div>
            </div>
        </section>
    );
}

/**
 * Calls `onEscape` for an Escape inside `view` that no control in it took, as a search field clearing its text does.
 * It listens on the document, which hears a key after React's handlers have.
 */
function useEscape(view: RefObject<HTMLElement | null>, onEscape: () => void): void {
    const latest = useRef(onEscape);
    latest.current = onEscape;
    useEffect(() => {
        const listener = (event: KeyboardEvent): void => {
            const inside = event.target instanceof Node && view.current?.contains(event.target) === true;
            if (inside && event.key === 'Escape' && !event.defaultPrevented) {
                event.preventDefault();
                latest.current();
            }
        };
        document.addEventListener('keydown', listener);
        return () => document.removeEventListener('keydown', listener);
    }, [view]);
}

function SectionList(props: {
    readonly current: SettingGroup | undefined;
    readonly onChoose: (group: SettingGroup) => void;
}) {
    const intl = useIntl();
    return (
        <ul className={styles['sections']}>
            {SETTING_GROUPS.map((group) => (
                <li key={group}>
                    <Button
                        className={`${BUTTON} ${styles['sectionButton'] ?? ''}`}
                        aria-current={props.current === group ? 'true' : false}
                        onPress={() => props.onChoose(group)}
                    >
                        {intl.formatMessage(settingGroupMessages[group])}
                    </Button>
                </li>
            ))}
        </ul>
    );
}

function SettingsSection(props: {
    readonly group: SettingGroup;
    readonly entries: readonly SettingEntry[];
    readonly children: (entry: SettingEntry) => ReactNode;
}) {
    const intl = useIntl();
    if (props.entries.length === 0) {
        return null;
    }
    const headingId = `trc-settings-${props.group}`;
    return (
        <section aria-labelledby={headingId} className={styles['section']}>
            <h3 id={headingId} className={styles['sectionHeading']}>
                {intl.formatMessage(settingGroupMessages[props.group])}
            </h3>
            {props.entries.map(props.children)}
        </section>
    );
}
