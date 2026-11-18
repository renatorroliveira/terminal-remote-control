import { Button } from 'react-aria-components';
import { useIntl } from 'react-intl';
import { useStore } from 'zustand';
import { REGION_ATTRIBUTE } from '../app/regions';
import { BUTTON } from '../ui/buttons';
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
    /** Whether the settings show in the terminal's place, which marks the Settings link current. */
    readonly settingsShown: boolean;
    /** Shows the settings (US-1.6.7). */
    readonly onSettings: () => void;
}

/**
 * The sidebar (US-1.6.1): at the top, the session tree, each host with its + button; below it, the known hosts and
 * the field that adds one; last, above the status bar, the Settings link (US-1.6.7).
 */
export function Sidebar({ id, className, workspace, onOpened, settingsShown, onSettings }: SidebarProps) {
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
                <Button
                    className={`${BUTTON} ${styles['settings'] ?? ''}`}
                    aria-current={settingsShown ? 'page' : false}
                    onPress={onSettings}
                >
                    {intl.formatMessage(sidebarMessages.settings)}
                </Button>
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
