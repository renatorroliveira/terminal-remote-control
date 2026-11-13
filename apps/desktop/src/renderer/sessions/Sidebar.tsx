import { useIntl } from 'react-intl';
import { useStore } from 'zustand';
import { REGION_ATTRIBUTE } from '../app/regions';
import { HostsPanel } from './HostsPanel';
import { sidebarMessages } from './messages';
import { SessionTree } from './SessionTree';
import styles from './Sidebar.module.css';
import type { WorkspaceController } from './workspace-controller';
import { hostGroups } from './workspace-model';

/** What the sidebar shows and reports. */
export interface SidebarProps {
    readonly id: string;
    readonly className: string;
    readonly workspace: WorkspaceController;
    /** Called after a session opens, so a narrow layout can hide the panel. */
    readonly onOpened: () => void;
}

/**
 * The sidebar (US-1.6.1): at the top, the session tree, each host with its + button; at the bottom, the known
 * hosts and the field that adds one.
 */
export function Sidebar({ id, className, workspace, onOpened }: SidebarProps) {
    const intl = useIntl();
    return (
        <nav
            id={id}
            {...{ [REGION_ATTRIBUTE]: 'sidebar' }}
            aria-label={intl.formatMessage(sidebarMessages.region)}
            className={className}
        >
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
    const empty = useStore(workspace.store, (state) => hostGroups(state).length === 0);
    return (
        <section aria-labelledby="trc-sessions-heading" className={styles['sessions']}>
            <h2 id="trc-sessions-heading" className={styles['heading']}>
                {intl.formatMessage(sidebarMessages.sessions)}
            </h2>
            {empty ? (
                <p className={styles['empty']}>{intl.formatMessage(sidebarMessages.noSessions)}</p>
            ) : (
                <SessionTree workspace={workspace} onOpened={onOpened} />
            )}
        </section>
    );
}
