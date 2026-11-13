import { type FormEvent, useRef, useState } from 'react';
import { Button, FieldError, Input, Label, Text, TextField } from 'react-aria-components';
import { type IntlShape, useIntl } from 'react-intl';
import { useStore } from 'zustand';
import { contextMenuMessages } from '../app/shell-messages';
import { hostActions } from '../app/workspace-actions';
import { BUTTON, PRIMARY_BUTTON } from '../ui/buttons';
import { useContextMenu } from '../ui/context-menu';
import { BusyIcon, ConnectedIcon, DisconnectedIcon } from '../ui/icons';
import styles from './HostsPanel.module.css';
import {
    connectionActionMessages,
    hostFailureMessage,
    hostKeyMessage,
    hostStateMessages,
    sidebarMessages,
} from './messages';
import type { WorkspaceController } from './workspace-controller';
import type { HostEntry } from './workspace-model';

/** What the hosts area needs. */
export interface HostsPanelProps {
    readonly workspace: WorkspaceController;
}

type Badge = 'connected' | 'disconnected' | 'busy';

/**
 * The known hosts (US-1.1, US-1.5): each with an icon-only connection button whose name says what pressing it does
 * and whose description gives the state; a host-key question when one waits; and the field that adds a host.
 */
export function HostsPanel({ workspace }: HostsPanelProps) {
    const intl = useIntl();
    const hosts = useStore(workspace.store, (state) => state.hosts);
    return (
        <section aria-labelledby="trc-hosts-heading" className={styles['panel']}>
            <h2 id="trc-hosts-heading" className={styles['heading']}>
                {intl.formatMessage(sidebarMessages.hosts)}
            </h2>
            {hosts.length === 0 ? (
                <p className={styles['empty']}>{intl.formatMessage(sidebarMessages.empty)}</p>
            ) : (
                <ul aria-label={intl.formatMessage(sidebarMessages.knownHosts)} className={styles['list']}>
                    {hosts.map((host) => (
                        <HostRow key={host.id} host={host} workspace={workspace} />
                    ))}
                </ul>
            )}
            {hosts.map((host) =>
                host.state.status === 'host-key' ? (
                    <HostKeyQuestion key={host.id} host={host} workspace={workspace} />
                ) : null,
            )}
            <AddHostForm workspace={workspace} />
        </section>
    );
}

function HostRow({ host, workspace }: { readonly host: HostEntry; readonly workspace: WorkspaceController }) {
    const intl = useIntl();
    const action = workspace.connectionAction(host);
    const badge = badgeOf(host);
    const descriptionId = `${host.id}-state`;
    const { triggerProps, menu } = useContextMenu(() => ({
        label: intl.formatMessage(contextMenuMessages.label, { target: host.destination }),
        items: hostActions(intl, workspace, host),
    }));
    const press = (): void => {
        if (action === 'review-key') {
            document.getElementById(`${host.id}-trust`)?.focus();
        } else {
            workspace.toggleConnection(host.id);
        }
    };
    return (
        <li className={styles['row']} {...triggerProps}>
            <span className={styles['name']}>{host.destination}</span>
            <Button
                className={styles['badge'] ?? ''}
                data-badge={badge}
                aria-label={intl.formatMessage(connectionActionMessages[action], { host: host.destination })}
                aria-describedby={descriptionId}
                onPress={press}
            >
                {badge === 'connected' ? <ConnectedIcon /> : badge === 'busy' ? <BusyIcon /> : <DisconnectedIcon />}
            </Button>
            <span id={descriptionId} hidden>
                {hostDescription(intl, host)}
            </span>
            {menu}
        </li>
    );
}

function HostKeyQuestion({ host, workspace }: { readonly host: HostEntry; readonly workspace: WorkspaceController }) {
    const intl = useIntl();
    if (host.state.status !== 'host-key') {
        return null;
    }
    const { key } = host.state;
    return (
        <fieldset className={styles['question']}>
            <legend className={styles['legend']}>
                {intl.formatMessage(hostKeyMessage, {
                    host: host.destination,
                    type: key.type,
                    fingerprint: key.fingerprint,
                })}
            </legend>
            <Button
                id={`${host.id}-trust`}
                className={BUTTON}
                onPress={() => workspace.acceptHostKey(host.id, key.fingerprint)}
            >
                {intl.formatMessage(sidebarMessages.trust)}
            </Button>
            <Button className={BUTTON} onPress={() => workspace.rejectHostKey(host.id)}>
                {intl.formatMessage(sidebarMessages.reject)}
            </Button>
        </fieldset>
    );
}

function AddHostForm({ workspace }: HostsPanelProps) {
    const intl = useIntl();
    const [address, setAddress] = useState('');
    const [invalid, setInvalid] = useState(false);
    const shown = useRef(address);
    shown.current = address;
    const submit = (event: FormEvent): void => {
        event.preventDefault();
        const submitted = address;
        const stillShown = (): boolean => shown.current === submitted;
        workspace.addHost(submitted).then(
            () => stillShown() && setAddress(''),
            () => stillShown() && setInvalid(true),
        );
    };
    return (
        <form className={styles['form']} onSubmit={submit}>
            <TextField
                value={address}
                onChange={(value) => {
                    setAddress(value);
                    setInvalid(false);
                }}
                isRequired
                isInvalid={invalid}
                className={styles['field'] ?? ''}
            >
                <Label>{intl.formatMessage(sidebarMessages.newHost)}</Label>
                <div className={styles['entry']}>
                    <Input className={styles['input'] ?? ''} />
                    <Button type="submit" className={PRIMARY_BUTTON}>
                        {intl.formatMessage(sidebarMessages.addHost)}
                    </Button>
                </div>
                <Text slot="description" className={styles['hint']}>
                    {intl.formatMessage(sidebarMessages.newHostHint)}
                </Text>
                <FieldError className={styles['error'] ?? ''}>
                    {intl.formatMessage(sidebarMessages.badAddress)}
                </FieldError>
            </TextField>
        </form>
    );
}

function badgeOf(host: HostEntry): Badge {
    switch (host.state.status) {
        case 'connected':
            return 'connected';
        case 'connecting':
        case 'host-key':
            return 'busy';
        default:
            return 'disconnected';
    }
}

function hostDescription(intl: IntlShape, host: HostEntry): string {
    const { state } = host;
    if (state.status === 'failed') {
        return intl.formatMessage(hostFailureMessage, { details: state.failure.details || state.failure.kind });
    }
    return intl.formatMessage(hostStateMessages[state.status === 'host-key' ? 'hostKey' : state.status]);
}
