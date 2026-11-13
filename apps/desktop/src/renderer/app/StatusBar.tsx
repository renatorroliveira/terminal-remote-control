import { Button, ToggleButton } from 'react-aria-components';
import { type IntlShape, useIntl } from 'react-intl';
import { useStore } from 'zustand';
import { hostStateText } from '../sessions/host-state-text';
import type { WorkspaceController } from '../sessions/workspace-controller';
import type { Workspace } from '../sessions/workspace-model';
import { BUTTON } from '../ui/buttons';
import { REGION_ATTRIBUTE } from './regions';
import styles from './StatusBar.module.css';
import type { Shell } from './shell';
import { statusMessages } from './shell-messages';

/** What the status bar reports on. */
export interface StatusBarProps {
    readonly workspace: WorkspaceController;
    readonly shell: Shell;
}

/**
 * The status bar (US-1.6.1): the open session's host and its connection, the daemon it reached, the Tab focus mode
 * and output mute toggles, and the notification list with its count. It is the last region (A11Y-05.2) and wraps in
 * a narrow window (A11Y-07.5).
 */
export function StatusBar({ workspace, shell }: StatusBarProps) {
    const intl = useIntl();
    const state = useStore(workspace.store);
    const { tabFocusMode, muted } = useStore(shell.state);
    const count = useStore(shell.notifications.store, (notifications) => notifications.items.length);
    return (
        <section
            {...{ [REGION_ATTRIBUTE]: 'status' }}
            aria-label={intl.formatMessage(statusMessages.region)}
            className={styles['bar']}
        >
            <span className={styles['item']}>{connectionText(intl, state)}</span>
            <span className={styles['item']}>{daemonText(intl, state)}</span>
            <span className={styles['controls']}>
                <ToggleButton
                    className={`${BUTTON} ${styles['toggle'] ?? ''}`}
                    isSelected={tabFocusMode}
                    onChange={() => shell.toggleTabFocus()}
                >
                    {intl.formatMessage(statusMessages.tabMovesFocus)}
                </ToggleButton>
                <ToggleButton
                    className={`${BUTTON} ${styles['toggle'] ?? ''}`}
                    isSelected={state.open !== undefined && muted.has(state.open)}
                    isDisabled={state.open === undefined}
                    onChange={() => shell.toggleMute()}
                >
                    {intl.formatMessage(statusMessages.mute)}
                </ToggleButton>
                <Button className={BUTTON} onPress={() => shell.setNotificationsOpen(true)}>
                    {intl.formatMessage(statusMessages.notifications, { count })}
                </Button>
            </span>
        </section>
    );
}

function openHost(state: Workspace) {
    const hostId = state.open?.split('/')[0];
    return state.hosts.find((host) => host.id === hostId);
}

function connectionText(intl: IntlShape, state: Workspace): string {
    const host = openHost(state);
    if (host !== undefined) {
        return intl.formatMessage(statusMessages.hostState, {
            host: host.destination,
            state: hostStateText(intl, host),
        });
    }
    if (state.hosts.length === 0) {
        return intl.formatMessage(statusMessages.noHosts);
    }
    const connected = state.hosts.filter((entry) => entry.state.status === 'connected').length;
    return intl.formatMessage(statusMessages.hostsConnected, { connected, total: state.hosts.length });
}

function daemonText(intl: IntlShape, state: Workspace): string {
    const host = openHost(state);
    return host?.state.status === 'connected'
        ? intl.formatMessage(statusMessages.daemon, { version: host.state.daemon.version })
        : intl.formatMessage(statusMessages.noDaemon);
}
