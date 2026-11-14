import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { useIntl } from 'react-intl';
import { useStore } from 'zustand';
import { BUTTON, PRIMARY_BUTTON } from '../ui/buttons';
import styles from '../ui/dialog.module.css';
import type { LogoutWarning } from './logout-warning';
import { logoutWarningMessages } from './messages';
import type { WorkspaceController } from './workspace-controller';

/** What the warning shows and answers. */
export interface LogoutWarningDialogProps {
    readonly workspace: WorkspaceController;
    readonly warning: LogoutWarning;
}

/** Warns before the first session on a host that ends its sessions when its last connection closes (US-2.4.4). */
export function LogoutWarningDialog({ workspace, warning }: LogoutWarningDialogProps) {
    const intl = useIntl();
    const hostId = useStore(warning.state, (state) => state.hostId);
    const host = useStore(workspace.store, (state) => state.hosts.find((entry) => entry.id === hostId));
    const values = { host: host?.destination ?? '' };
    return (
        <ModalOverlay
            isOpen={hostId !== undefined}
            onOpenChange={(open) => open || warning.answer(false)}
            isDismissable
            className={styles['overlay'] ?? ''}
        >
            <Modal className={styles['modal'] ?? ''}>
                <Dialog role="alertdialog" aria-describedby="trc-logout-text" className={styles['dialog'] ?? ''}>
                    <Heading slot="title" className={styles['heading'] ?? ''}>
                        {intl.formatMessage(logoutWarningMessages.title, values)}
                    </Heading>
                    <p id="trc-logout-text" className={styles['text']}>
                        {intl.formatMessage(logoutWarningMessages.body, values)}
                    </p>
                    <div className={styles['actions']}>
                        <Button className={BUTTON} onPress={() => warning.answer(false)}>
                            {intl.formatMessage(logoutWarningMessages.cancel)}
                        </Button>
                        <Button autoFocus className={PRIMARY_BUTTON} onPress={() => warning.answer(true)}>
                            {intl.formatMessage(logoutWarningMessages.create)}
                        </Button>
                    </div>
                </Dialog>
            </Modal>
        </ModalOverlay>
    );
}
