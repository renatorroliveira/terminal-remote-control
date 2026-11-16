import { BusyIcon, ConnectedIcon, DisconnectedIcon, EndedIcon } from '../ui/icons';
import styles from './SessionTree.module.css';
import type { SessionItem } from './workspace-model';

/** Which shape a session's state takes (P-48). */
export type StateBadgeKind = 'running' | 'busy' | 'disconnected' | 'ended';

/**
 * A session's state as a shape at the end of its row (P-48, US-1.9.3): filled while it runs, half filled while it
 * starts or its host reconnects, hollow while its host is disconnected, and a ring with a dash once it ended. The
 * row's accessible name says the state, so the shape is hidden from AT; its tooltip names it for the pointer.
 */
export function SessionStateBadge({ item, state }: { readonly item: SessionItem; readonly state: string }) {
    const kind = stateBadgeKind(item);
    return (
        <span aria-hidden="true" data-state-badge={kind} title={state} className={styles['stateBadge']}>
            <BadgeIcon kind={kind} />
        </span>
    );
}

function BadgeIcon({ kind }: { readonly kind: StateBadgeKind }) {
    switch (kind) {
        case 'running':
            return <ConnectedIcon />;
        case 'busy':
            return <BusyIcon />;
        case 'disconnected':
            return <DisconnectedIcon />;
        case 'ended':
            return <EndedIcon />;
    }
}

function stateBadgeKind(item: SessionItem): StateBadgeKind {
    if (item.disconnected) {
        return item.reconnecting ? 'busy' : 'disconnected';
    }
    switch (item.session.state) {
        case 'running':
            return 'running';
        case 'starting':
            return 'busy';
        default:
            return 'ended';
    }
}
