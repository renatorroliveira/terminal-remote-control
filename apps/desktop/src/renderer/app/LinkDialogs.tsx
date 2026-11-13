import {
    Button,
    Dialog,
    Heading,
    Input,
    Label,
    ListBox,
    ListBoxItem,
    Modal,
    ModalOverlay,
    TextField,
} from 'react-aria-components';
import { useIntl } from 'react-intl';
import { useStore } from 'zustand';
import type { LinkCheck } from '../../shared/links';
import type { TerminalLink } from '../terminal/hyperlinks';
import { BUTTON, PRIMARY_BUTTON } from '../ui/buttons';
import styles from '../ui/dialog.module.css';
import { confirmLinkMessages, linkListMessages } from './link-messages';
import type { Shell } from './shell';

/** What the link dialogs act on. */
export interface LinkDialogsProps {
    readonly shell: Shell;
}

/** The link confirmation (US-1.12.4) and the List links dialog (US-1.12.3). */
export function LinkDialogs({ shell }: LinkDialogsProps) {
    const dialog = useStore(shell.state, (state) => state.linkDialog);
    const close = (): void => shell.setLinkDialog(undefined);
    return (
        <ModalOverlay
            isOpen={dialog !== undefined}
            onOpenChange={(open) => open || close()}
            isDismissable
            className={styles['overlay'] ?? ''}
        >
            <Modal className={styles['modal'] ?? ''}>
                {dialog?.kind === 'confirm' && (
                    <ConfirmLink shell={shell} text={dialog.text} check={dialog.check} onClose={close} />
                )}
                {dialog?.kind === 'list' && <LinkList shell={shell} links={dialog.links} onClose={close} />}
            </Modal>
        </ModalOverlay>
    );
}

interface ConfirmLinkProps {
    readonly shell: Shell;
    readonly text: string;
    readonly check: LinkCheck;
    readonly onClose: () => void;
}

function ConfirmLink({ shell, text, check, onClose }: ConfirmLinkProps) {
    const intl = useIntl();
    const explanation =
        text === check.target || text === ''
            ? intl.formatMessage(confirmLinkMessages.check)
            : intl.formatMessage(confirmLinkMessages.differs, { text });
    return (
        <Dialog role="alertdialog" aria-describedby="trc-link-text" className={styles['dialog'] ?? ''}>
            <Heading slot="title" className={styles['heading'] ?? ''}>
                {intl.formatMessage(confirmLinkMessages.title)}
            </Heading>
            <p id="trc-link-text" className={styles['text']}>
                {explanation}
            </p>
            <TextField isReadOnly value={check.target} className={styles['field'] ?? ''}>
                <Label>{intl.formatMessage(confirmLinkMessages.address)}</Label>
                <Input autoFocus className={styles['input'] ?? ''} />
            </TextField>
            {check.origin !== undefined && (
                <p className={styles['hint']}>
                    {intl.formatMessage(confirmLinkMessages.trustHint, { origin: check.origin })}
                </p>
            )}
            <div className={styles['actions']}>
                <Button className={BUTTON} onPress={onClose}>
                    {intl.formatMessage(confirmLinkMessages.cancel)}
                </Button>
                {check.origin !== undefined && (
                    <Button className={BUTTON} onPress={() => void shell.confirmLink(true)}>
                        {intl.formatMessage(confirmLinkMessages.trust, { origin: check.origin })}
                    </Button>
                )}
                <Button className={PRIMARY_BUTTON} onPress={() => void shell.confirmLink(false)}>
                    {intl.formatMessage(confirmLinkMessages.open)}
                </Button>
            </div>
        </Dialog>
    );
}

interface LinkListProps {
    readonly shell: Shell;
    readonly links: readonly TerminalLink[];
    readonly onClose: () => void;
}

function LinkList({ shell, links, onClose }: LinkListProps) {
    const intl = useIntl();
    const items = links.map((link, index) => ({ ...link, id: String(index) }));
    return (
        <Dialog className={styles['dialog'] ?? ''}>
            <Heading slot="title" className={styles['heading'] ?? ''}>
                {intl.formatMessage(linkListMessages.title)}
            </Heading>
            <ListBox
                aria-label={intl.formatMessage(linkListMessages.list)}
                items={items}
                autoFocus="first"
                onAction={(key) => {
                    const link = items.find((item) => item.id === key);
                    if (link !== undefined) {
                        void shell.openLink(link);
                    }
                }}
                className={styles['options'] ?? ''}
            >
                {(link) => (
                    <ListBoxItem id={link.id} textValue={link.text} className={styles['option'] ?? ''}>
                        <span>{link.text}</span>
                        {link.target !== link.text && (
                            <>
                                {' '}
                                <span className={styles['hint']}>{link.target}</span>
                            </>
                        )}
                    </ListBoxItem>
                )}
            </ListBox>
            <div className={styles['actions']}>
                <Button className={BUTTON} onPress={onClose}>
                    {intl.formatMessage(linkListMessages.close)}
                </Button>
            </div>
        </Dialog>
    );
}
