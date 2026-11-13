import { Button, Heading } from 'react-aria-components';
import { type IntlShape, useIntl } from 'react-intl';
import { PlusIcon } from '../ui/icons';
import styles from './HostSessions.module.css';
import { hostSessionsMessages, hostStateMessages } from './messages';
import { SessionList } from './SessionList';
import type { WorkspaceController } from './workspace-controller';
import { type HostEntry, type HostGroup, isConnected } from './workspace-model';

/** What one host's section shows and reports. */
export interface HostSessionsProps {
    readonly group: HostGroup;
    readonly workspace: WorkspaceController;
    /** The session shown in the terminal area. */
    readonly open: string | undefined;
    /** Called after a session opens, so a narrow layout can hide the panel. */
    readonly onOpened: () => void;
}

/** Marks the + buttons, where focus goes when the focused session disappears. */
export const NEW_SESSION_ATTRIBUTE = 'data-new-session';

/**
 * One host in the Sessions area (US-1.6.2, US-1.7.1): a heading whose disclosure button (caret, name and state)
 * collapses the host, a + button named "New session on <host>" while it is connected, and its session list.
 */
export function HostSessions({ group, workspace, open, onOpened }: HostSessionsProps) {
    const intl = useIntl();
    const { host, expanded } = group;
    const listId = `${host.id}-sessions`;
    return (
        <section aria-labelledby={`${host.id}-heading`} className={styles['host']}>
            <Heading level={3} id={`${host.id}-heading`} className={styles['heading'] ?? ''}>
                <Button
                    className={styles['disclosure'] ?? ''}
                    aria-expanded={expanded}
                    aria-controls={listId}
                    onPress={() => workspace.toggle(host.id)}
                >
                    <span aria-hidden="true" className={styles['caret']}>
                        {expanded ? '▾' : '▸'}
                    </span>
                    <span className={styles['name']}>{host.destination}</span>{' '}
                    <span className={styles['state']}>{hostStateText(intl, host)}</span>
                </Button>
            </Heading>
            {isConnected(host) && (
                <Button
                    {...{ [NEW_SESSION_ATTRIBUTE]: '' }}
                    className={styles['add'] ?? ''}
                    aria-label={intl.formatMessage(hostSessionsMessages.newSession, { host: host.destination })}
                    onPress={() => void workspace.newSession(host.id).then(onOpened)}
                >
                    <PlusIcon />
                </Button>
            )}
            <SessionList
                id={listId}
                label={intl.formatMessage(hostSessionsMessages.sessions, { host: host.destination })}
                items={group.sessions}
                open={open}
                hidden={!expanded || group.sessions.length === 0}
                onOpen={(key) => {
                    workspace.open(key);
                    onOpened();
                }}
            />
        </section>
    );
}

function hostStateText(intl: IntlShape, host: HostEntry): string {
    const status = host.state.status;
    return intl.formatMessage(hostStateMessages[status === 'host-key' ? 'hostKey' : status]);
}
