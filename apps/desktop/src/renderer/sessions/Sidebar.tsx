import type { ReactNode } from 'react';
import { Button } from 'react-aria-components';
import { useIntl } from 'react-intl';
import { useStore } from 'zustand';
import { sidebarMessages } from './messages';
import { SessionTree } from './SessionTree';
import styles from './Sidebar.module.css';
import type { WorkspaceController } from './workspace-controller';
import { treeItems } from './workspace-model';

/** What the sidebar shows and reports. */
export interface SidebarProps {
    readonly id: string;
    readonly className: string;
    readonly workspace: WorkspaceController;
    /** Called after a session opens, so a narrow layout can hide the panel. */
    readonly onOpened: () => void;
    readonly testHost: ReactNode;
}

/** The sessions region: the New session button and the tree of hosts and sessions (US-1.6.2, US-1.7.1). */
export function Sidebar({ id, className, workspace, onOpened, testHost }: SidebarProps) {
    const intl = useIntl();
    const state = useStore(workspace.store);
    const items = treeItems(state);
    const headingId = `${id}-heading`;

    return (
        <nav id={id} aria-labelledby={headingId} className={className}>
            <div className={styles['body'] ?? ''}>
                <h2 id={headingId} className={styles['heading'] ?? ''}>
                    {intl.formatMessage(sidebarMessages.region)}
                </h2>
                {testHost}
                <Button
                    className={styles['button'] ?? ''}
                    isDisabled={!workspace.canCreate(state)}
                    onPress={() => void workspace.newSession().then(onOpened)}
                >
                    {intl.formatMessage(sidebarMessages.newSession)}
                </Button>
                {items.length === 0 ? (
                    <p className={styles['empty'] ?? ''}>{intl.formatMessage(sidebarMessages.empty)}</p>
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
            </div>
        </nav>
    );
}
