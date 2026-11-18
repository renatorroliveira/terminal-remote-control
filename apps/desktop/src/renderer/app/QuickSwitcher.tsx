import { useRef, useState } from 'react';
import {
    Autocomplete,
    Dialog,
    Input,
    Label,
    ListBox,
    ListBoxItem,
    Modal,
    ModalOverlay,
    SearchField,
    useFilter,
} from 'react-aria-components';
import { type IntlShape, useIntl } from 'react-intl';
import { useStore } from 'zustand';
import { sessionStateText } from '../sessions/session-state-text';
import type { WorkspaceController } from '../sessions/workspace-controller';
import { hostGroups, type SessionKey, type Workspace } from '../sessions/workspace-model';
import styles from './CommandPalette.module.css';
import { switcherMessages } from './quick-switcher-messages';
import type { Shell } from './shell';

/** What the quick switcher opens. */
export interface QuickSwitcherProps {
    readonly shell: Shell;
    readonly workspace: WorkspaceController;
}

/** One session the quick switcher lists: what it shows, and what a search matches. */
export interface SwitcherEntry {
    readonly key: SessionKey;
    readonly label: string;
    /** The name, the host and the title, which a search matches (US-5.4.1). */
    readonly searchText: string;
}

/**
 * The quick switcher (US-5.4): every session on every host, filtered by name, host and title as the user types,
 * with the count of those shown announced. Choosing one closes it and opens the session as the session list does
 * (US-1.8); Escape just closes it, and focus goes back to where it was.
 */
export function QuickSwitcher({ shell, workspace }: QuickSwitcherProps) {
    const open = useStore(shell.state, (state) => state.switcherOpen);
    return (
        <ModalOverlay
            isOpen={open}
            isDismissable
            onOpenChange={(isOpen) => isOpen || shell.closeSwitcher()}
            className={styles['overlay'] ?? ''}
        >
            <Modal className={styles['modal'] ?? ''}>
                {open && <SwitcherContent shell={shell} workspace={workspace} />}
            </Modal>
        </ModalOverlay>
    );
}

/** The sessions of every host the session list shows, in its order. */
export function switcherEntries(intl: IntlShape, workspace: Workspace): readonly SwitcherEntry[] {
    return hostGroups(workspace).flatMap((group) =>
        group.sessions.map((item) => ({
            key: item.key,
            label: intl.formatMessage(switcherMessages.entry, {
                session: item.label,
                host: group.host.destination,
                state: sessionStateText(intl, item),
            }),
            searchText: [item.label, group.host.destination, item.session.title ?? ''].join(' '),
        })),
    );
}

function SwitcherContent({ shell, workspace }: QuickSwitcherProps) {
    const intl = useIntl();
    const { contains } = useFilter({ sensitivity: 'base' });
    const [query, setQuery] = useState('');
    const entries = useRef(switcherEntries(intl, workspace.store.getState())).current;
    const shown = entries.filter((entry) => contains(entry.searchText, query)).length;
    return (
        <Dialog aria-label={intl.formatMessage(switcherMessages.title)} className={styles['dialog'] ?? ''}>
            <Autocomplete inputValue={query} onInputChange={setQuery} filter={contains}>
                <SearchField autoFocus className={styles['search'] ?? ''}>
                    <Label className={styles['label'] ?? ''}>{intl.formatMessage(switcherMessages.search)}</Label>
                    <Input className={styles['input'] ?? ''} />
                </SearchField>
                <p role="status" className={styles['empty']}>
                    {intl.formatMessage(switcherMessages.count, { count: shown })}
                </p>
                <ListBox
                    items={entries}
                    className={styles['list'] ?? ''}
                    aria-label={intl.formatMessage(switcherMessages.title)}
                    onAction={(key) => shell.closeSwitcher(() => workspace.open(String(key)))}
                >
                    {(entry) => (
                        <ListBoxItem id={entry.key} textValue={entry.searchText} className={styles['item'] ?? ''}>
                            {entry.label}
                        </ListBoxItem>
                    )}
                </ListBox>
            </Autocomplete>
        </Dialog>
    );
}
