import type { PersistenceFailure } from '@trc/protocol';
import type { IntlShape } from 'react-intl';
import type { StoreApi } from 'zustand/vanilla';
import {
    persistenceFailedMessage,
    persistenceFailureMessages,
    restoreAnnouncements,
} from '../sessions/restore-messages';
import {
    type HostGroup,
    hostGroups,
    type SessionItem,
    type SessionKey,
    type Workspace,
} from '../sessions/workspace-model';
import type { Announcer } from './announcer';
import type { NotificationCenter } from './notifications';
import type { AudioCue } from './sound/audio-cues';

/** What the session reporter needs from the shell. */
export interface SessionReporterOptions {
    readonly store: StoreApi<Workspace>;
    readonly intl: IntlShape;
    readonly announcer: Pick<Announcer, 'announce'>;
    readonly notifications: Pick<NotificationCenter, 'add'>;
    readonly playCue: (cue: AudioCue) => void;
}

/**
 * Announces politely, and lists, the sessions each host restored that are still badged Restored: once per host
 * and restore, saying whether the host restarted (US-3.1.6, P-42). Returns the function that stops watching.
 */
export function reportRestores(options: SessionReporterOptions): () => void {
    const reported = new Map<SessionKey, number>();
    const report = (state: Workspace, before: Workspace) => {
        for (const group of hostGroups(state)) {
            const fresh = freshRestores(group, before.restoreSeen, reported);
            if (fresh.length > 0) {
                announceRestores(options, group, fresh);
            }
        }
    };
    report(options.store.getState(), options.store.getState());
    return options.store.subscribe(report);
}

/**
 * Announces assertively, and lists, each session whose scrollback the daemon cannot save, once until saving works
 * again (US-3.1.2). Returns the function that stops watching.
 */
export function reportPersistenceFailures(options: SessionReporterOptions): () => void {
    let failing: ReadonlySet<SessionKey> = new Set();
    const report = (state: Workspace) => {
        const failures = persistenceFailures(state);
        for (const failure of failures.filter((entry) => !failing.has(entry.item.key))) {
            announceFailure(options, failure);
        }
        failing = new Set(failures.map((entry) => entry.item.key));
    };
    report(options.store.getState());
    return options.store.subscribe(report);
}

interface FailingSession {
    readonly item: SessionItem;
    readonly host: string;
    readonly failure: PersistenceFailure;
}

function persistenceFailures(state: Workspace): readonly FailingSession[] {
    return hostGroups(state).flatMap((group) =>
        group.sessions.flatMap((item) => {
            const failure = item.session.persistenceFailure;
            return failure === undefined ? [] : [{ item, host: group.host.destination, failure }];
        }),
    );
}

function announceFailure(options: SessionReporterOptions, { item, host, failure }: FailingSession): void {
    const reason = options.intl.formatMessage(persistenceFailureMessages[failure]);
    const text = options.intl.formatMessage(persistenceFailedMessage, { session: item.label, host, reason });
    options.playCue('failed');
    options.notifications.add({ text, level: 'error' });
    options.announcer.announce(text, { group: `persistence:${item.key}`, politeness: 'assertive' });
}

/**
 * The restores of a host's sessions not yet reported and not opened before this change, so the session open when
 * its restore arrives, which that change marks seen, still counts.
 */
function freshRestores(
    group: HostGroup,
    seen: ReadonlyMap<SessionKey, number>,
    reported: Map<SessionKey, number>,
): readonly { afterHostRestart: boolean }[] {
    return group.sessions.flatMap((item) => {
        const restored = item.session.restored;
        if (restored === undefined || seen.get(item.key) === restored.at || reported.get(item.key) === restored.at) {
            return [];
        }
        reported.set(item.key, restored.at);
        return [{ afterHostRestart: restored.afterHostRestart }];
    });
}

function announceRestores(
    options: SessionReporterOptions,
    group: HostGroup,
    fresh: readonly { afterHostRestart: boolean }[],
): void {
    const message = fresh.some((entry) => entry.afterHostRestart)
        ? restoreAnnouncements.afterRestart
        : restoreAnnouncements.restored;
    const text = options.intl.formatMessage(message, { host: group.host.destination, count: fresh.length });
    options.notifications.add({ text, level: 'info' });
    options.announcer.announce(text, { group: `restore:${group.host.id}` });
}
