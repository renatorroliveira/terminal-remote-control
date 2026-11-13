import { useState } from 'react';
import { Button, Label, ListBox, ListBoxItem, Popover, Select, SelectValue } from 'react-aria-components';
import { useIntl } from 'react-intl';
import { useStore } from 'zustand';
import { BUTTON, PRIMARY_BUTTON } from '../ui/buttons';
import { HostsPanel } from './HostsPanel';
import { sidebarMessages } from './messages';
import { SessionTree } from './SessionTree';
import styles from './Sidebar.module.css';
import type { WorkspaceController } from './workspace-controller';
import { isConnected, treeItems } from './workspace-model';

/** The New session button's element ID, where focus goes when the focused session disappears. */
export const NEW_SESSION_ID = 'trc-new-session';

/** What the sidebar shows and reports. */
export interface SidebarProps {
    readonly id: string;
    readonly className: string;
    readonly workspace: WorkspaceController;
    /** Called after a session opens, so a narrow layout can hide the panel. */
    readonly onOpened: () => void;
}

/**
 * The sidebar (US-1.6.1): at the top, the open sessions by host with the host a new session starts on and the New
 * session button; at the bottom, the known hosts and the field that adds one.
 */
export function Sidebar({ id, className, workspace, onOpened }: SidebarProps) {
    const intl = useIntl();
    return (
        <nav id={id} aria-label={intl.formatMessage(sidebarMessages.region)} className={className}>
            <div className={styles['layout']}>
                <SessionsPanel workspace={workspace} onOpened={onOpened} />
                <div className={styles['hosts']}>
                    <HostsPanel workspace={workspace} />
                </div>
            </div>
        </nav>
    );
}

function SessionsPanel({ workspace, onOpened }: Pick<SidebarProps, 'workspace' | 'onOpened'>) {
    const intl = useIntl();
    const state = useStore(workspace.store);
    const items = treeItems(state);
    const connected = state.hosts.filter(isConnected);
    const [picked, setPicked] = useState<string>();
    const target = connected.some((host) => host.id === picked) ? picked : workspace.defaultHost(state);
    return (
        <section aria-labelledby="trc-sessions-heading" className={styles['sessions']}>
            <h2 id="trc-sessions-heading" className={styles['heading']}>
                {intl.formatMessage(sidebarMessages.sessions)}
            </h2>
            {items.length === 0 ? (
                <p className={styles['empty']}>{intl.formatMessage(sidebarMessages.noSessions)}</p>
            ) : (
                <SessionTree
                    items={items}
                    open={state.open}
                    onOpen={(key) => {
                        workspace.open(key);
                        onOpened();
                    }}
                    onToggle={(hostId) => workspace.toggle(hostId)}
                />
            )}
            <div className={styles['create']}>
                <Select
                    value={target ?? null}
                    onChange={(key) => setPicked(typeof key === 'string' ? key : undefined)}
                    isDisabled={connected.length === 0}
                    placeholder={intl.formatMessage(sidebarMessages.noConnectedHost)}
                    className={styles['select'] ?? ''}
                >
                    <Label className={styles['label'] ?? ''}>
                        {intl.formatMessage(sidebarMessages.newSessionHost)}
                    </Label>
                    <Button className={`${BUTTON} ${styles['control'] ?? ''}`}>
                        <SelectValue />
                        <span aria-hidden="true">▾</span>
                    </Button>
                    <Popover className={styles['popover'] ?? ''}>
                        <ListBox items={connected} className={styles['options'] ?? ''}>
                            {(host) => (
                                <ListBoxItem
                                    id={host.id}
                                    textValue={host.destination}
                                    className={styles['option'] ?? ''}
                                >
                                    {host.destination}
                                </ListBoxItem>
                            )}
                        </ListBox>
                    </Popover>
                </Select>
                <Button
                    id={NEW_SESSION_ID}
                    className={PRIMARY_BUTTON}
                    isDisabled={target === undefined}
                    onPress={() => void workspace.newSession(target).then(onOpened)}
                >
                    {intl.formatMessage(sidebarMessages.newSession)}
                </Button>
            </div>
        </section>
    );
}
