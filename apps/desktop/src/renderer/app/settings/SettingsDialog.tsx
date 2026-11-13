import { useState } from 'react';
import { Button, Dialog, Heading, Input, Label, Modal, ModalOverlay, SearchField } from 'react-aria-components';
import { useIntl } from 'react-intl';
import { useStore } from 'zustand';
import type { WorkspaceController } from '../../sessions/workspace-controller';
import { PRIMARY_BUTTON } from '../../ui/buttons';
import type { Shell } from '../shell';
import { SettingControl } from './SettingControl';
import styles from './SettingsDialog.module.css';
import { SETTING_ENTRIES, SETTING_GROUPS, type SettingEntry, settingsMatching } from './settings-catalog';
import { settingGroupMessages, settingsPageMessages } from './settings-messages';
import type { SettingsStore } from './settings-store';

/** What the settings page edits. */
export interface SettingsDialogProps {
    readonly shell: Shell;
    readonly workspace: WorkspaceController;
}

/**
 * The settings page (A11Y-10.3): every setting in sections, a search field that filters them as the user types and
 * says how many are shown, and controls that apply each change at once. Escape or Close returns focus.
 */
export function SettingsDialog({ shell, workspace }: SettingsDialogProps) {
    const open = useStore(shell.state, (state) => state.settingsOpen);
    const settings = shell.settings;
    if (settings === undefined) {
        return null;
    }
    return (
        <ModalOverlay
            isOpen={open}
            isDismissable
            onOpenChange={(isOpen) => isOpen || shell.closeSettings()}
            className={styles['overlay'] ?? ''}
        >
            <Modal className={styles['modal'] ?? ''}>
                <Dialog className={styles['dialog'] ?? ''}>
                    <SettingsPage shell={shell} settings={settings} workspace={workspace} />
                </Dialog>
            </Modal>
        </ModalOverlay>
    );
}

function SettingsPage({ shell, settings, workspace }: SettingsDialogProps & { readonly settings: SettingsStore }) {
    const intl = useIntl();
    const [query, setQuery] = useState('');
    const available = SETTING_ENTRIES.filter(
        (entry) => entry.id !== 'screenReaderMode' || shell.screenReaderMode !== undefined,
    );
    const shown = settingsMatching(available, query, intl);
    return (
        <>
            <Heading slot="title" className={styles['heading'] ?? ''}>
                {intl.formatMessage(settingsPageMessages.title)}
            </Heading>
            <SearchField value={query} onChange={setQuery} autoFocus className={styles['search'] ?? ''}>
                <Label>{intl.formatMessage(settingsPageMessages.search)}</Label>
                <Input className={styles['input'] ?? ''} />
            </SearchField>
            <p role="status" className={styles['status']}>
                {shown.length === 0
                    ? intl.formatMessage(settingsPageMessages.none)
                    : intl.formatMessage(settingsPageMessages.shown, { shown: shown.length, total: available.length })}
            </p>
            {SETTING_GROUPS.map((group) => (
                <SettingsSection key={group} group={group} entries={shown.filter((entry) => entry.group === group)}>
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
            <div className={styles['actions']}>
                <Button className={PRIMARY_BUTTON} onPress={() => shell.closeSettings()}>
                    {intl.formatMessage(settingsPageMessages.close)}
                </Button>
            </div>
        </>
    );
}

function SettingsSection(props: {
    readonly group: (typeof SETTING_GROUPS)[number];
    readonly entries: readonly SettingEntry[];
    readonly children: (entry: SettingEntry) => React.ReactNode;
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
