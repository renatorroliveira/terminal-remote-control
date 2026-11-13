import { type FormEvent, useState } from 'react';
import {
    Button,
    Dialog,
    FieldError,
    Heading,
    Input,
    Label,
    Modal,
    ModalOverlay,
    Text,
    TextField,
} from 'react-aria-components';
import { useIntl } from 'react-intl';
import { useStore } from 'zustand';
import { isInstallRoot } from '../../shared/hosts';
import type { Shell } from '../app/shell';
import { BUTTON, PRIMARY_BUTTON } from '../ui/buttons';
import styles from '../ui/dialog.module.css';
import { forgetMessages, hostKeyDialogMessages, installRootMessages } from './host-messages';
import { sidebarMessages } from './messages';
import type { WorkspaceController } from './workspace-controller';
import type { HostEntry } from './workspace-model';

/** What the host dialogs act on. */
export interface HostDialogsProps {
    readonly workspace: WorkspaceController;
    readonly shell: Shell;
}

/** Where focus goes after a host is forgotten: the Add host field. */
export const ADD_HOST_ATTRIBUTE = 'data-add-host';

/** The dialogs about one host: the host key question (US-1.2.1), Forget (A11Y-11.9) and the install location. */
export function HostDialogs({ workspace, shell }: HostDialogsProps) {
    return (
        <>
            <HostKeyDialog workspace={workspace} />
            <ForgetHostDialog workspace={workspace} shell={shell} />
            <InstallRootDialog workspace={workspace} shell={shell} />
        </>
    );
}

/**
 * Asks whether to trust an unknown host key (US-1.2.1), with no time limit: the host, the key type and the SHA-256
 * fingerprint in a read-only field the user can select and copy. Trust records the key in known_hosts; Reject or
 * Escape aborts the connection.
 */
function HostKeyDialog({ workspace }: Pick<HostDialogsProps, 'workspace'>) {
    const intl = useIntl();
    const host = useStore(workspace.store, (state) => state.hosts.find((entry) => entry.state.status === 'host-key'));
    const key = host?.state.status === 'host-key' ? host.state.key : undefined;
    const reject = (): void => {
        if (host !== undefined) {
            workspace.rejectHostKey(host.id);
        }
    };
    return (
        <ModalOverlay
            isOpen={key !== undefined}
            onOpenChange={(open) => open || reject()}
            className={styles['overlay'] ?? ''}
        >
            <Modal className={styles['modal'] ?? ''}>
                {host !== undefined && key !== undefined && (
                    <Dialog role="alertdialog" aria-describedby="trc-host-key-text" className={styles['dialog'] ?? ''}>
                        <Heading slot="title" className={styles['heading'] ?? ''}>
                            {intl.formatMessage(hostKeyDialogMessages.title, { host: host.destination })}
                        </Heading>
                        <p id="trc-host-key-text" className={styles['text']}>
                            {intl.formatMessage(hostKeyDialogMessages.explanation, {
                                host: host.destination,
                                type: key.type,
                            })}
                        </p>
                        <TextField isReadOnly value={key.fingerprint} className={styles['field'] ?? ''}>
                            <Label>{intl.formatMessage(hostKeyDialogMessages.fingerprint)}</Label>
                            <Input autoFocus className={styles['input'] ?? ''} />
                        </TextField>
                        <div className={styles['actions']}>
                            <Button className={BUTTON} onPress={reject}>
                                {intl.formatMessage(sidebarMessages.reject)}
                            </Button>
                            <Button
                                className={PRIMARY_BUTTON}
                                onPress={() => workspace.acceptHostKey(host.id, key.fingerprint)}
                            >
                                {intl.formatMessage(sidebarMessages.trust)}
                            </Button>
                        </div>
                    </Dialog>
                )}
            </Modal>
        </ModalOverlay>
    );
}

function useDialogHost(props: HostDialogsProps, kind: 'forget' | 'install-root'): HostEntry | undefined {
    const dialog = useStore(props.shell.state, (state) => state.hostDialog);
    const hosts = useStore(props.workspace.store, (state) => state.hosts);
    return dialog?.kind === kind ? hosts.find((host) => host.id === dialog.hostId) : undefined;
}

/** Confirms forgetting a host, naming what it removes and what stays (A11Y-11.9); Cancel has focus. */
function ForgetHostDialog(props: HostDialogsProps) {
    const intl = useIntl();
    const host = useDialogHost(props, 'forget');
    const close = (): void => props.shell.setHostDialog(undefined);
    const forget = (): void => {
        if (host === undefined) {
            return;
        }
        close();
        void props.workspace.forgetHost(host.id).then(() => {
            setTimeout(() => document.querySelector<HTMLElement>(`[${ADD_HOST_ATTRIBUTE}]`)?.focus(), 0);
        });
    };
    return (
        <ModalOverlay
            isOpen={host !== undefined}
            onOpenChange={(open) => open || close()}
            className={styles['overlay'] ?? ''}
        >
            <Modal className={styles['modal'] ?? ''}>
                {host !== undefined && (
                    <Dialog role="alertdialog" aria-describedby="trc-forget-text" className={styles['dialog'] ?? ''}>
                        <Heading slot="title" className={styles['heading'] ?? ''}>
                            {intl.formatMessage(forgetMessages.title, { host: host.destination })}
                        </Heading>
                        <p id="trc-forget-text" className={styles['text']}>
                            {intl.formatMessage(forgetMessages.body, { host: host.destination })}
                        </p>
                        <div className={styles['actions']}>
                            <Button autoFocus className={BUTTON} onPress={close}>
                                {intl.formatMessage(forgetMessages.cancel)}
                            </Button>
                            <Button className={PRIMARY_BUTTON} onPress={forget}>
                                {intl.formatMessage(forgetMessages.confirm)}
                            </Button>
                        </div>
                    </Dialog>
                )}
            </Modal>
        </ModalOverlay>
    );
}

/** Moves a host's install location for hosts whose home folder cannot run programs (US-1.4.3). */
function InstallRootDialog(props: HostDialogsProps) {
    const host = useDialogHost(props, 'install-root');
    const close = (): void => props.shell.setHostDialog(undefined);
    return (
        <ModalOverlay
            isOpen={host !== undefined}
            onOpenChange={(open) => open || close()}
            className={styles['overlay'] ?? ''}
        >
            <Modal className={styles['modal'] ?? ''}>
                {host !== undefined && <InstallRootForm host={host} workspace={props.workspace} onClose={close} />}
            </Modal>
        </ModalOverlay>
    );
}

function InstallRootForm(props: {
    readonly host: HostEntry;
    readonly workspace: WorkspaceController;
    readonly onClose: () => void;
}) {
    const intl = useIntl();
    const [root, setRoot] = useState(props.host.installRoot);
    const [invalid, setInvalid] = useState(false);
    const save = (event: FormEvent): void => {
        event.preventDefault();
        const trimmed = root.trim();
        if (!isInstallRoot(trimmed)) {
            setInvalid(true);
            return;
        }
        void props.workspace.moveInstallRoot(props.host.id, trimmed).then(props.onClose, () => setInvalid(true));
    };
    return (
        <Dialog className={styles['dialog'] ?? ''}>
            <Heading slot="title" className={styles['heading'] ?? ''}>
                {intl.formatMessage(installRootMessages.title, { host: props.host.destination })}
            </Heading>
            <form onSubmit={save} className={styles['dialog'] ?? ''}>
                <TextField
                    value={root}
                    onChange={(value) => {
                        setRoot(value);
                        setInvalid(false);
                    }}
                    isRequired
                    isInvalid={invalid}
                    className={styles['field'] ?? ''}
                >
                    <Label>{intl.formatMessage(installRootMessages.label)}</Label>
                    <Input autoFocus className={styles['input'] ?? ''} />
                    <Text slot="description" className={styles['hint']}>
                        {intl.formatMessage(installRootMessages.hint)}
                    </Text>
                    <FieldError className={styles['error'] ?? ''}>
                        {intl.formatMessage(installRootMessages.invalid)}
                    </FieldError>
                </TextField>
                <div className={styles['actions']}>
                    <Button className={BUTTON} onPress={props.onClose}>
                        {intl.formatMessage(installRootMessages.cancel)}
                    </Button>
                    <Button type="submit" className={PRIMARY_BUTTON}>
                        {intl.formatMessage(installRootMessages.save)}
                    </Button>
                </div>
            </form>
        </Dialog>
    );
}
