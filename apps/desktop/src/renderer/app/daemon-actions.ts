import type { IntlShape } from 'react-intl';
import type { DaemonRemoval } from '../../shared/connection';
import { daemonAnnouncements } from '../sessions/daemon-messages';
import { failureMessage } from '../sessions/failure-messages';
import type { WorkspaceController } from '../sessions/workspace-controller';
import type { HostEntry } from '../sessions/workspace-model';
import type { Announcer } from './announcer';
import type { NotificationCenter } from './notifications';
import type { AudioCue } from './sound/audio-cues';

/** What the daemon actions need from the shell. */
export interface DaemonActionOptions {
    readonly workspace: WorkspaceController;
    readonly intl: IntlShape;
    readonly announcer: Pick<Announcer, 'announce'>;
    readonly notifications: Pick<NotificationCenter, 'add'>;
    readonly playCue: (cue: AudioCue) => void;
}

/**
 * Restarts a host's daemon and says so; the shell reports the reconnection as the restart's end, and a refusal is
 * reported as an action failure (US-3.3.2).
 */
export async function restartDaemon(options: DaemonActionOptions, hostId: string): Promise<void> {
    const host = hostOf(options, hostId);
    if (host === undefined) {
        return;
    }
    options.announcer.announce(options.intl.formatMessage(daemonAnnouncements.restarting, { host: host.destination }), {
        group: hostId,
    });
    await options.workspace.restartDaemon(hostId);
}

/**
 * Removes a host's daemon and says how that went: what the install location kept that TRC did not write, or why
 * the removal failed, announced and listed in Notifications (US-3.3.3, A11Y-12.2). Resolves with whether the daemon
 * was removed.
 */
export async function removeDaemon(options: DaemonActionOptions, hostId: string): Promise<boolean> {
    const host = hostOf(options, hostId);
    if (host === undefined) {
        return false;
    }
    const { intl, announcer } = options;
    announcer.announce(intl.formatMessage(daemonAnnouncements.removing, { host: host.destination }), { group: hostId });
    const removal = await options.workspace.removeDaemon(hostId);
    if (removal !== undefined) {
        report(options, host, removal);
    }
    return removal?.kind === 'removed';
}

function report(options: DaemonActionOptions, host: HostEntry, removal: DaemonRemoval): void {
    const { intl, announcer, notifications } = options;
    if (removal.kind === 'removed') {
        const values = { host: host.destination, root: host.installRoot, count: removal.kept.length };
        const message = removal.kept.length === 0 ? daemonAnnouncements.removed : daemonAnnouncements.removedKept;
        const text = intl.formatMessage(message, values);
        notifications.add({ text, level: 'info' });
        announcer.announce(text, { group: host.id });
        return;
    }
    const { problem } = failureMessage(intl, host.destination, removal.failure);
    const text = intl.formatMessage(daemonAnnouncements.removeFailed, { host: host.destination, problem });
    options.playCue('failed');
    notifications.add({ text, level: 'error' });
    announcer.announce(text, { group: host.id, politeness: 'assertive' });
}

function hostOf(options: DaemonActionOptions, hostId: string): HostEntry | undefined {
    return options.workspace.store.getState().hosts.find((host) => host.id === hostId);
}
