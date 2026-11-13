import { useRef } from 'react';
import {
    Autocomplete,
    Dialog,
    Input,
    Label,
    Menu,
    MenuItem,
    Modal,
    ModalOverlay,
    SearchField,
    useFilter,
} from 'react-aria-components';
import { useIntl } from 'react-intl';
import { useStore } from 'zustand';
import type { WorkspaceController } from '../sessions/workspace-controller';
import styles from './CommandPalette.module.css';
import type { Shell } from './shell';
import { paletteMessages } from './shell-messages';
import { paletteActions, type WorkspaceAction } from './workspace-actions';

/** What the palette runs. */
export interface CommandPaletteProps {
    readonly shell: Shell;
    readonly workspace: WorkspaceController;
}

/**
 * The command palette (A11Y-11.11): every command, host action and session, filtered as the user types, each with
 * its shortcut, which its accessible name includes because it is visible text (WCAG 2.5.3). Choosing one closes the palette, returns focus to where it was, then runs it; Escape just closes it.
 */
export function CommandPalette({ shell, workspace }: CommandPaletteProps) {
    const open = useStore(shell.state, (state) => state.paletteOpen);
    return (
        <ModalOverlay
            isOpen={open}
            isDismissable
            onOpenChange={(isOpen) => isOpen || shell.closePalette()}
            className={styles['overlay'] ?? ''}
        >
            <Modal className={styles['modal'] ?? ''}>
                {open && <PaletteContent shell={shell} workspace={workspace} />}
            </Modal>
        </ModalOverlay>
    );
}

function PaletteContent({ shell, workspace }: CommandPaletteProps) {
    const intl = useIntl();
    const { contains } = useFilter({ sensitivity: 'base' });
    const actions = useRef(paletteActions(intl, shell, workspace)).current;
    const choose = (action: WorkspaceAction): void => shell.closePalette(() => action.run());
    return (
        <Dialog aria-label={intl.formatMessage(paletteMessages.title)} className={styles['dialog'] ?? ''}>
            <Autocomplete filter={contains}>
                <SearchField autoFocus className={styles['search'] ?? ''}>
                    <Label className={styles['label'] ?? ''}>{intl.formatMessage(paletteMessages.search)}</Label>
                    <Input className={styles['input'] ?? ''} />
                </SearchField>
                <Menu
                    items={actions}
                    className={styles['list'] ?? ''}
                    aria-label={intl.formatMessage(paletteMessages.title)}
                    renderEmptyState={() => (
                        <p className={styles['empty']}>{intl.formatMessage(paletteMessages.empty)}</p>
                    )}
                    onAction={(key) => {
                        const action = actions.find((entry) => entry.id === key);
                        if (action !== undefined) {
                            choose(action);
                        }
                    }}
                >
                    {(action) => (
                        <MenuItem id={action.id} textValue={action.label} className={styles['item'] ?? ''}>
                            <span>{action.label}</span>
                            {action.shortcut !== undefined && (
                                <>
                                    {' '}
                                    <kbd className={styles['shortcut'] ?? ''}>{action.shortcut}</kbd>
                                </>
                            )}
                        </MenuItem>
                    )}
                </Menu>
            </Autocomplete>
        </Dialog>
    );
}
