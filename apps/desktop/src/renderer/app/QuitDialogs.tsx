import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { useIntl } from 'react-intl';
import { useStore } from 'zustand';
import { BUTTON, PRIMARY_BUTTON } from '../ui/buttons';
import styles from '../ui/dialog.module.css';
import type { QuitDialog, QuitFlow } from './quit-flow';
import { firstQuitMessages, stopAllMessages } from './quit-messages';

/** What the quit dialogs act on. */
export interface QuitDialogsProps {
    readonly quit: QuitFlow;
}

/** The first-quit notice and the confirmation of Quit and Stop All Sessions (US-2.1.4, US-2.1.5). */
export function QuitDialogs({ quit }: QuitDialogsProps) {
    const dialog = useStore(quit.state, (state) => state.dialog);
    return (
        <ModalOverlay
            isOpen={dialog !== undefined}
            onOpenChange={(open) => open || quit.cancel()}
            isDismissable
            className={styles['overlay'] ?? ''}
        >
            <Modal className={styles['modal'] ?? ''}>
                {dialog?.kind === 'first-quit' && <FirstQuit quit={quit} />}
                {dialog?.kind === 'stop-all' && <StopAll quit={quit} running={dialog.running} />}
            </Modal>
        </ModalOverlay>
    );
}

function FirstQuit({ quit }: QuitDialogsProps) {
    const intl = useIntl();
    return (
        <Dialog role="alertdialog" aria-describedby="trc-first-quit-text" className={styles['dialog'] ?? ''}>
            <Heading slot="title" className={styles['heading'] ?? ''}>
                {intl.formatMessage(firstQuitMessages.title)}
            </Heading>
            <p id="trc-first-quit-text" className={styles['text']}>
                {intl.formatMessage(firstQuitMessages.body)}
            </p>
            <div className={styles['actions']}>
                <Button className={BUTTON} onPress={() => quit.cancel()}>
                    {intl.formatMessage(firstQuitMessages.cancel)}
                </Button>
                <Button className={BUTTON} onPress={() => quit.requestStopAll()}>
                    {intl.formatMessage(firstQuitMessages.stopAll)}
                </Button>
                <Button autoFocus className={PRIMARY_BUTTON} onPress={() => quit.quit()}>
                    {intl.formatMessage(firstQuitMessages.quit)}
                </Button>
            </div>
        </Dialog>
    );
}

function StopAll({ quit, running }: QuitDialogsProps & Pick<Extract<QuitDialog, { kind: 'stop-all' }>, 'running'>) {
    const intl = useIntl();
    const stopping = useStore(quit.state, (state) => state.stopping);
    return (
        <Dialog role="alertdialog" aria-describedby="trc-stop-all-text" className={styles['dialog'] ?? ''}>
            <Heading slot="title" className={styles['heading'] ?? ''}>
                {intl.formatMessage(stopAllMessages.title)}
            </Heading>
            <div id="trc-stop-all-text">
                <p className={styles['text']}>
                    {intl.formatMessage(stopAllMessages.body, { sessions: running.sessions, hosts: running.hosts })}
                </p>
                {running.unreachable.length > 0 && (
                    <p className={styles['text']}>
                        {intl.formatMessage(stopAllMessages.unreachable, {
                            hosts: intl.formatList(running.unreachable),
                        })}
                    </p>
                )}
            </div>
            <div className={styles['actions']}>
                <Button autoFocus className={BUTTON} onPress={() => quit.cancel()}>
                    {intl.formatMessage(stopAllMessages.cancel)}
                </Button>
                <Button className={PRIMARY_BUTTON} isDisabled={stopping} onPress={() => void quit.confirmStopAll()}>
                    {intl.formatMessage(stopping ? stopAllMessages.stopping : stopAllMessages.confirm)}
                </Button>
            </div>
        </Dialog>
    );
}
