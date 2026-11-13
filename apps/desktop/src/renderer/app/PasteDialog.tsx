import { Button, Dialog, Heading, Label, Modal, ModalOverlay, TextArea, TextField } from 'react-aria-components';
import { useIntl } from 'react-intl';
import { useStore } from 'zustand';
import { BUTTON, PRIMARY_BUTTON } from '../ui/buttons';
import styles from '../ui/dialog.module.css';
import { pasteMessages } from './paste-messages';
import type { Shell } from './shell';

/** What the paste confirmation acts on. */
export interface PasteDialogProps {
    readonly shell: Shell;
}

const PREVIEW_ROWS = 6;

/** Asks before a paste of more than one line, stating the line count and showing the text (US-1.12.2). */
export function PasteDialog({ shell }: PasteDialogProps) {
    const intl = useIntl();
    const paste = useStore(shell.state, (state) => state.pasteDialog);
    return (
        <ModalOverlay
            isOpen={paste !== undefined}
            onOpenChange={(open) => open || shell.cancelPaste()}
            isDismissable
            className={styles['overlay'] ?? ''}
        >
            <Modal className={styles['modal'] ?? ''}>
                {paste !== undefined && (
                    <Dialog role="alertdialog" aria-describedby="trc-paste-text" className={styles['dialog'] ?? ''}>
                        <Heading slot="title" className={styles['heading'] ?? ''}>
                            {intl.formatMessage(pasteMessages.title, { lines: paste.lines })}
                        </Heading>
                        <p id="trc-paste-text" className={styles['text']}>
                            {intl.formatMessage(pasteMessages.body)}
                        </p>
                        <TextField isReadOnly value={paste.text} className={styles['field'] ?? ''}>
                            <Label>{intl.formatMessage(pasteMessages.preview)}</Label>
                            <TextArea autoFocus rows={PREVIEW_ROWS} className={styles['input'] ?? ''} />
                        </TextField>
                        <div className={styles['actions']}>
                            <Button className={BUTTON} onPress={() => shell.cancelPaste()}>
                                {intl.formatMessage(pasteMessages.cancel)}
                            </Button>
                            <Button className={PRIMARY_BUTTON} onPress={() => shell.confirmPaste()}>
                                {intl.formatMessage(pasteMessages.paste)}
                            </Button>
                        </div>
                    </Dialog>
                )}
            </Modal>
        </ModalOverlay>
    );
}
