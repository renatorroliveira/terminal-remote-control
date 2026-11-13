import { type FormEvent, useEffect, useRef, useState } from 'react';
import {
    Button,
    ComboBox,
    FieldError,
    Input,
    Label,
    ListBox,
    ListBoxItem,
    Popover,
    Text,
    TextField,
    useFilter,
} from 'react-aria-components';
import { type IntlShape, useIntl } from 'react-intl';
import { useStore } from 'zustand';
import { useShell } from '../app/shell-context';
import { contextMenuMessages } from '../app/shell-messages';
import { hostActions } from '../app/workspace-actions';
import { PRIMARY_BUTTON } from '../ui/buttons';
import { useContextMenu } from '../ui/context-menu';
import { BusyIcon, ConnectedIcon, DisconnectedIcon } from '../ui/icons';
import { ADD_HOST_ATTRIBUTE } from './HostDialogs';
import styles from './HostsPanel.module.css';
import { addHostMessages } from './host-messages';
import { hostStateText } from './host-state-text';
import { connectionActionMessages, hostFailureMessage, sidebarMessages } from './messages';
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
            <AddHostForm workspace={workspace} />
        </section>
    );
}

function HostRow({ host, workspace }: { readonly host: HostEntry; readonly workspace: WorkspaceController }) {
    const intl = useIntl();
    const action = workspace.connectionAction(host);
    const badge = badgeOf(host);
    const descriptionId = `${host.id}-state`;
    const shell = useShell();
    const { triggerProps, menu } = useContextMenu(() => ({
        label: intl.formatMessage(contextMenuMessages.label, { target: host.destination }),
        items: hostActions(intl, workspace, host, shell),
    }));
    const press = (): void => {
        if (action !== 'review-key') {
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

function AddHostForm({ workspace }: HostsPanelProps) {
    const intl = useIntl();
    const [address, setAddress] = useState('');
    const [user, setUser] = useState('');
    const [problem, setProblem] = useState<'address' | 'two-users' | undefined>();
    const suggestions = useSuggestions(workspace);
    const { contains } = useFilter({ sensitivity: 'base' });
    const shown = useRef(address);
    shown.current = address;
    const submit = (event: FormEvent): void => {
        event.preventDefault();
        const typed = address.trim();
        if (user.trim() !== '' && typed.includes('@')) {
            setProblem('two-users');
            return;
        }
        const submitted = user.trim() === '' ? typed : `${user.trim()}@${typed}`;
        const stillShown = (): boolean => shown.current === address;
        workspace.addHost(submitted).then(
            () => {
                if (stillShown()) {
                    setAddress('');
                    setUser('');
                }
            },
            () => stillShown() && setProblem('address'),
        );
    };
    const edited = (): void => setProblem(undefined);
    return (
        <form className={styles['form']} onSubmit={submit}>
            <ComboBox
                inputValue={address}
                onInputChange={(value) => {
                    setAddress(value);
                    edited();
                }}
                allowsCustomValue
                isRequired
                isInvalid={problem === 'address'}
                items={suggestions.filter((suggestion) => contains(suggestion, address)).map((id) => ({ id }))}
                className={styles['combo'] ?? ''}
            >
                <Label>{intl.formatMessage(sidebarMessages.newHost)}</Label>
                <div className={styles['entry']}>
                    <Input {...{ [ADD_HOST_ATTRIBUTE]: '' }} className={styles['input'] ?? ''} />
                    <Button slot={null} type="submit" className={PRIMARY_BUTTON}>
                        {intl.formatMessage(sidebarMessages.addHost)}
                    </Button>
                </div>
                <Text slot="description" className={styles['hint']}>
                    {intl.formatMessage(sidebarMessages.newHostHint)}
                </Text>
                <FieldError className={styles['error'] ?? ''}>
                    {intl.formatMessage(sidebarMessages.badAddress)}
                </FieldError>
                <Popover className={styles['popover'] ?? ''}>
                    <ListBox className={styles['suggestions'] ?? ''}>
                        {(item: { readonly id: string }) => (
                            <ListBoxItem id={item.id} className={styles['suggestion'] ?? ''}>
                                {item.id}
                            </ListBoxItem>
                        )}
                    </ListBox>
                </Popover>
            </ComboBox>
            <TextField
                value={user}
                onChange={(value) => {
                    setUser(value);
                    edited();
                }}
                isInvalid={problem === 'two-users'}
                className={styles['user'] ?? ''}
            >
                <Label>{intl.formatMessage(addHostMessages.user)}</Label>
                <Input autoComplete="username" className={styles['input'] ?? ''} />
                <FieldError className={styles['error'] ?? ''}>
                    {intl.formatMessage(addHostMessages.twoUsers)}
                </FieldError>
            </TextField>
        </form>
    );
}

function useSuggestions(workspace: WorkspaceController): readonly string[] {
    const [suggestions, setSuggestions] = useState<readonly string[]>([]);
    const hosts = useStore(workspace.store, (state) => state.hosts);
    useEffect(() => {
        let current = true;
        const added = new Set(hosts.map((host) => host.destination));
        void workspace.suggestions().then(
            (found) => current && setSuggestions(found.filter((address) => !added.has(address))),
            () => undefined,
        );
        return () => {
            current = false;
        };
    }, [workspace, hosts]);
    return suggestions;
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
    return hostStateText(intl, host);
}
