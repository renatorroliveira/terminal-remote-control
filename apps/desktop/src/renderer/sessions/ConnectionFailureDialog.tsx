import { Button, Dialog, Heading, Label, Modal, ModalOverlay, TextArea, TextField } from 'react-aria-components';
import { useIntl } from 'react-intl';
import { useStore } from 'zustand';
import { PRIMARY_BUTTON } from '../ui/buttons';
import styles from './ConnectionFailureDialog.module.css';
import { failureMessage } from './failure-messages';
import { failureDialogMessages } from './messages';
import type { WorkspaceController } from './workspace-controller';
import type { HostEntry } from './workspace-model';

/** What the failure dialog reports on. */
export interface ConnectionFailureDialogProps {
    readonly workspace: WorkspaceController;
}

/**
 * Reports a failed connection in a modal alert over the dimmed app (US-1.3): what went wrong, how to fix it, and
 * the copyable details, until the user presses OK. Focus then returns to where it was.
 */
export function ConnectionFailureDialog({ workspace }: ConnectionFailureDialogProps) {
    const host = useStore(workspace.store, (state) => state.hosts.find((entry) => entry.id === state.failureNotice));
    const failed = host?.state.status === 'failed' ? host : undefined;
    return (
        <ModalOverlay
            isOpen={failed !== undefined}
            onOpenChange={(open) => open || workspace.acknowledgeFailure()}
            className={styles['overlay'] ?? ''}
        >
            <Modal className={styles['modal'] ?? ''}>
                {failed && <FailureContent host={failed} onClose={() => workspace.acknowledgeFailure()} />}
            </Modal>
        </ModalOverlay>
    );
}

function FailureContent({ host, onClose }: { readonly host: HostEntry; readonly onClose: () => void }) {
    const intl = useIntl();
    if (host.state.status !== 'failed') {
        return null;
    }
    const { failure } = host.state;
    const { problem, remedy } = failureMessage(intl, host.destination, failure);
    const problemId = `${host.id}-failure-problem`;
    const remedyId = `${host.id}-failure-remedy`;
    return (
        <Dialog role="alertdialog" aria-describedby={`${problemId} ${remedyId}`} className={styles['dialog'] ?? ''}>
            <Heading slot="title" className={styles['heading'] ?? ''}>
                {intl.formatMessage(failureDialogMessages.title, { host: host.destination })}
            </Heading>
            <p id={problemId} className={styles['text']}>
                {problem}
            </p>
            <p id={remedyId} className={styles['text']}>
                {remedy}
            </p>
            {failure.details !== '' && (
                <TextField isReadOnly value={failure.details} className={styles['details'] ?? ''}>
                    <Label>{intl.formatMessage(failureDialogMessages.details)}</Label>
                    <TextArea className={styles['detailsText'] ?? ''} rows={4} />
                </TextField>
            )}
            <div className={styles['actions']}>
                <Button autoFocus className={PRIMARY_BUTTON} onPress={onClose}>
                    {intl.formatMessage(failureDialogMessages.ok)}
                </Button>
            </div>
        </Dialog>
    );
}
