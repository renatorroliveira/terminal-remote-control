import type { ShellProfile } from '@trc/protocol';
import { type FormEvent, useEffect, useState } from 'react';
import {
    Button,
    Dialog,
    FieldError,
    Heading,
    Input,
    Label,
    ListBox,
    ListBoxItem,
    Modal,
    ModalOverlay,
    Popover,
    Select,
    SelectValue,
    Text,
    TextArea,
    TextField,
} from 'react-aria-components';
import { useIntl } from 'react-intl';
import { useStore } from 'zustand';
import type { SessionDialog, Shell } from '../app/shell';
import { BUTTON, PRIMARY_BUTTON } from '../ui/buttons';
import styles from '../ui/dialog.module.css';
import { parseEnvironment } from './environment';
import { closeMessages, newSessionMessages, renameMessages } from './session-messages';
import type { SessionOptions, WorkspaceController } from './workspace-controller';
import { hostGroups, isConnected, type SessionItem } from './workspace-model';

/** What the session dialogs act on. */
export interface SessionDialogsProps {
    readonly workspace: WorkspaceController;
    readonly shell: Shell;
}

/** The dialogs about sessions: Rename (US-1.10.1), Close (US-1.10.4) and New session (US-1.7.2). */
export function SessionDialogs(props: SessionDialogsProps) {
    const dialog = useStore(props.shell.state, (state) => state.sessionDialog);
    const close = (): void => props.shell.setSessionDialog(undefined);
    return (
        <ModalOverlay
            isOpen={dialog !== undefined}
            onOpenChange={(open) => open || close()}
            className={styles['overlay'] ?? ''}
        >
            <Modal className={styles['modal'] ?? ''}>
                {dialog !== undefined && <DialogFor dialog={dialog} onClose={close} {...props} />}
            </Modal>
        </ModalOverlay>
    );
}

interface DialogForProps extends SessionDialogsProps {
    readonly dialog: SessionDialog;
    readonly onClose: () => void;
}

function DialogFor(props: DialogForProps) {
    const { dialog } = props;
    const state = useStore(props.workspace.store);
    const item =
        dialog.kind === 'new'
            ? undefined
            : hostGroups(state)
                  .flatMap((group) => group.sessions.map((entry) => ({ entry, host: group.host.destination })))
                  .find(({ entry }) => entry.key === dialog.key);
    if (dialog.kind === 'new') {
        return <NewSessionForm {...props} hostId={dialog.hostId} />;
    }
    if (item === undefined) {
        return null;
    }
    return dialog.kind === 'rename' ? (
        <RenameForm item={item.entry} {...props} />
    ) : (
        <CloseConfirmation item={item.entry} host={item.host} {...props} />
    );
}

function RenameForm(props: DialogForProps & { readonly item: SessionItem }) {
    const intl = useIntl();
    const [name, setName] = useState(props.item.session.customName ?? '');
    const save = (event: FormEvent): void => {
        event.preventDefault();
        props.onClose();
        void props.workspace.renameSession(props.item.key, name);
    };
    return (
        <Dialog className={styles['dialog'] ?? ''}>
            <Heading slot="title" className={styles['heading'] ?? ''}>
                {intl.formatMessage(renameMessages.title, { session: props.item.label })}
            </Heading>
            <form onSubmit={save} className={styles['dialog'] ?? ''}>
                <TextField value={name} onChange={setName} className={styles['field'] ?? ''}>
                    <Label>{intl.formatMessage(renameMessages.label)}</Label>
                    <Input autoFocus className={styles['input'] ?? ''} />
                    <Text slot="description" className={styles['hint']}>
                        {intl.formatMessage(renameMessages.hint)}
                    </Text>
                </TextField>
                <div className={styles['actions']}>
                    <Button className={BUTTON} onPress={props.onClose}>
                        {intl.formatMessage(renameMessages.cancel)}
                    </Button>
                    <Button type="submit" className={PRIMARY_BUTTON}>
                        {intl.formatMessage(renameMessages.save)}
                    </Button>
                </div>
            </form>
        </Dialog>
    );
}

function CloseConfirmation(props: DialogForProps & { readonly item: SessionItem; readonly host: string }) {
    const intl = useIntl();
    const confirm = (): void => {
        props.onClose();
        void props.workspace.closeSession(props.item.key);
    };
    return (
        <Dialog role="alertdialog" aria-describedby="trc-close-text" className={styles['dialog'] ?? ''}>
            <Heading slot="title" className={styles['heading'] ?? ''}>
                {intl.formatMessage(closeMessages.title, { session: props.item.label })}
            </Heading>
            <p id="trc-close-text" className={styles['text']}>
                {intl.formatMessage(closeMessages.body, { session: props.item.label, host: props.host })}
            </p>
            <div className={styles['actions']}>
                <Button autoFocus className={BUTTON} onPress={props.onClose}>
                    {intl.formatMessage(closeMessages.cancel)}
                </Button>
                <Button className={PRIMARY_BUTTON} onPress={confirm}>
                    {intl.formatMessage(closeMessages.confirm)}
                </Button>
            </div>
        </Dialog>
    );
}

interface NewSessionFields {
    readonly cwd: string;
    readonly name: string;
    readonly env: string;
}

function NewSessionForm(props: DialogForProps & { readonly hostId: string | undefined }) {
    const intl = useIntl();
    const hosts = useStore(props.workspace.store, (state) => state.hosts).filter(isConnected);
    const [hostId, setHostId] = useState(props.hostId ?? hosts[0]?.id);
    const profiles = useProfiles(props.workspace, hostId);
    const [profileId, setProfileId] = useState<string>();
    const [fields, setFields] = useState<NewSessionFields>({ cwd: '', name: '', env: '' });
    const [envInvalid, setEnvInvalid] = useState(false);
    const create = (event: FormEvent): void => {
        event.preventDefault();
        const options = sessionOptions(fields, profileId ?? profiles[0]?.id);
        if (options === undefined) {
            setEnvInvalid(true);
        } else if (hostId !== undefined) {
            props.onClose();
            void props.workspace.newSessionWith(hostId, options);
        }
    };
    const field = (key: keyof NewSessionFields) => (value: string) => {
        setFields((current) => ({ ...current, [key]: value }));
        setEnvInvalid(false);
    };
    return (
        <Dialog className={styles['dialog'] ?? ''}>
            <Heading slot="title" className={styles['heading'] ?? ''}>
                {intl.formatMessage(newSessionMessages.title)}
            </Heading>
            {hosts.length === 0 ? (
                <p className={styles['text']}>{intl.formatMessage(newSessionMessages.noHost)}</p>
            ) : (
                <form onSubmit={create} className={styles['dialog'] ?? ''}>
                    <Choice
                        label={intl.formatMessage(newSessionMessages.host)}
                        options={hosts.map((host) => ({ id: host.id, label: host.destination }))}
                        selected={hostId}
                        onChange={(id) => {
                            setHostId(id);
                            setProfileId(undefined);
                        }}
                        autoFocus
                    />
                    <Choice
                        label={intl.formatMessage(newSessionMessages.profile)}
                        options={profiles.map((profile) => ({ id: profile.id, label: profile.name }))}
                        selected={profileId ?? profiles[0]?.id}
                        onChange={setProfileId}
                    />
                    <SessionFields fields={fields} envInvalid={envInvalid} onChange={field} />
                    <div className={styles['actions']}>
                        <Button className={BUTTON} onPress={props.onClose}>
                            {intl.formatMessage(newSessionMessages.cancel)}
                        </Button>
                        <Button type="submit" className={PRIMARY_BUTTON}>
                            {intl.formatMessage(newSessionMessages.create)}
                        </Button>
                    </div>
                </form>
            )}
        </Dialog>
    );
}

interface SessionFieldsProps {
    readonly fields: NewSessionFields;
    readonly envInvalid: boolean;
    readonly onChange: (key: keyof NewSessionFields) => (value: string) => void;
}

function SessionFields({ fields, envInvalid, onChange }: SessionFieldsProps) {
    const intl = useIntl();
    return (
        <>
            <TextField value={fields.cwd} onChange={onChange('cwd')} className={styles['field'] ?? ''}>
                <Label>{intl.formatMessage(newSessionMessages.cwd)}</Label>
                <Input className={styles['input'] ?? ''} />
                <Text slot="description" className={styles['hint']}>
                    {intl.formatMessage(newSessionMessages.cwdHint)}
                </Text>
            </TextField>
            <TextField value={fields.name} onChange={onChange('name')} className={styles['field'] ?? ''}>
                <Label>{intl.formatMessage(newSessionMessages.name)}</Label>
                <Input className={styles['input'] ?? ''} />
            </TextField>
            <TextField
                value={fields.env}
                onChange={onChange('env')}
                isInvalid={envInvalid}
                className={styles['field'] ?? ''}
            >
                <Label>{intl.formatMessage(newSessionMessages.env)}</Label>
                <TextArea rows={3} className={styles['input'] ?? ''} />
                <Text slot="description" className={styles['hint']}>
                    {intl.formatMessage(newSessionMessages.envHint)}
                </Text>
                <FieldError className={styles['error'] ?? ''}>
                    {intl.formatMessage(newSessionMessages.envInvalid)}
                </FieldError>
            </TextField>
        </>
    );
}

function sessionOptions(fields: NewSessionFields, profileId: string | undefined): SessionOptions | undefined {
    const env = parseEnvironment(fields.env);
    if (env === undefined) {
        return undefined;
    }
    const cwd = fields.cwd.trim();
    const name = fields.name.trim();
    return {
        ...(profileId === undefined ? {} : { profileId }),
        ...(cwd === '' ? {} : { cwd }),
        ...(name === '' ? {} : { name }),
        env,
    };
}

interface ChoiceProps {
    readonly label: string;
    readonly options: readonly { readonly id: string; readonly label: string }[];
    readonly selected: string | undefined;
    readonly onChange: (id: string) => void;
    readonly autoFocus?: boolean;
}

function Choice(props: ChoiceProps) {
    return (
        <Select
            selectedKey={props.selected ?? null}
            onSelectionChange={(key) => key !== null && props.onChange(String(key))}
            autoFocus={props.autoFocus === true}
            className={styles['field'] ?? ''}
        >
            <Label>{props.label}</Label>
            <Button className={BUTTON}>
                <SelectValue />
            </Button>
            <Popover className={styles['popover'] ?? ''}>
                <ListBox items={props.options} className={styles['options'] ?? ''}>
                    {(option) => (
                        <ListBoxItem id={option.id} className={styles['option'] ?? ''}>
                            {option.label}
                        </ListBoxItem>
                    )}
                </ListBox>
            </Popover>
        </Select>
    );
}

function useProfiles(workspace: WorkspaceController, hostId: string | undefined): readonly ShellProfile[] {
    const [profiles, setProfiles] = useState<readonly ShellProfile[]>([]);
    useEffect(() => {
        let current = true;
        setProfiles([]);
        if (hostId !== undefined) {
            void workspace.profiles(hostId).then(
                (found) => current && setProfiles(found),
                () => undefined,
            );
        }
        return () => {
            current = false;
        };
    }, [workspace, hostId]);
    return profiles;
}
