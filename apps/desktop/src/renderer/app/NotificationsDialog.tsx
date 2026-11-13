import { Button, Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { useIntl } from 'react-intl';
import { useStore } from 'zustand';
import { BUTTON } from '../ui/buttons';
import styles from './NotificationsDialog.module.css';
import type { Shell } from './shell';
import { notificationMessages } from './shell-messages';

/** Whose notifications the dialog lists. */
export interface NotificationsDialogProps {
    readonly shell: Shell;
}

/**
 * The persistent notification list (TECH_STACK §4.3): every notification, newest first, with its time and a button
 * that dismisses it, plus Clear all. Nothing leaves the list on its own; Escape or Close returns focus.
 */
export function NotificationsDialog({ shell }: NotificationsDialogProps) {
    const intl = useIntl();
    const open = useStore(shell.state, (state) => state.notificationsOpen);
    const items = useStore(shell.notifications.store, (state) => state.items);
    const close = (): void => shell.setNotificationsOpen(false);
    return (
        <ModalOverlay
            isOpen={open}
            isDismissable
            onOpenChange={(isOpen) => shell.setNotificationsOpen(isOpen)}
            className={styles['overlay'] ?? ''}
        >
            <Modal className={styles['modal'] ?? ''}>
                <Dialog className={styles['dialog'] ?? ''}>
                    <Heading slot="title" className={styles['heading'] ?? ''}>
                        {intl.formatMessage(notificationMessages.title)}
                    </Heading>
                    {items.length === 0 ? (
                        <p className={styles['empty']}>{intl.formatMessage(notificationMessages.empty)}</p>
                    ) : (
                        <ul className={styles['list']}>
                            {items.map((item) => (
                                <li key={item.id} className={styles['item']}>
                                    <span className={styles['text']}>{item.text}</span>
                                    <time dateTime={new Date(item.time).toISOString()} className={styles['time']}>
                                        {intl.formatTime(item.time)}
                                    </time>
                                    <Button
                                        className={BUTTON}
                                        aria-label={intl.formatMessage(notificationMessages.dismissNamed, {
                                            text: item.text,
                                        })}
                                        onPress={() => shell.notifications.dismiss(item.id)}
                                    >
                                        {intl.formatMessage(notificationMessages.dismiss)}
                                    </Button>
                                </li>
                            ))}
                        </ul>
                    )}
                    <div className={styles['actions']}>
                        <Button
                            className={BUTTON}
                            isDisabled={items.length === 0}
                            onPress={() => shell.notifications.clear()}
                        >
                            {intl.formatMessage(notificationMessages.clear)}
                        </Button>
                        <Button autoFocus className={BUTTON} onPress={close}>
                            {intl.formatMessage(notificationMessages.close)}
                        </Button>
                    </div>
                </Dialog>
            </Modal>
        </ModalOverlay>
    );
}
