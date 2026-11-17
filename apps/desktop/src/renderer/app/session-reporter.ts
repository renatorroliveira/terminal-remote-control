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

/** How long a host's restores may keep arriving, a list or one session event at a time, before they are announced. */
export const RESTORE_SETTLE_MS = 750;

/**
 * Announces politely, and lists, the sessions each host restored that are still badged Restored: once per host
 * and restore, saying whether the host restarted (US-3.1.6, P-42). Restores that arrive within
 * {@link RESTORE_SETTLE_MS} of each other make one announcement. Returns the function that stops watching.
 */
export function reportRestores(options: SessionReporterOptions): () => void {
    const reported = new Map<SessionKey, number>();
    const batches = new RestoreBatches(options);
    const report = (state: Workspace, before: Workspace) => {
        for (const group of hostGroups(state)) {
            batches.add(group, freshRestores(group, before.restoreSeen, reported));
        }
    };
    report(options.store.getState(), options.store.getState());
    const stop = options.store.subscribe(report);
    return () => {
        stop();
        batches.clear();
    };
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

interface RestoreBatch {
    readonly host: string;
    count: number;
    afterHostRestart: boolean;
    timer: ReturnType<typeof setTimeout> | undefined;
}

/** Each host's restores waiting to be announced together, until none arrives for a moment. */
class RestoreBatches {
    readonly #options: SessionReporterOptions;
    readonly #batches = new Map<string, RestoreBatch>();

    constructor(options: SessionReporterOptions) {
        this.#options = options;
    }

    add(group: HostGroup, fresh: readonly { afterHostRestart: boolean }[]): void {
        if (fresh.length === 0) {
            return;
        }
        const hostId = group.host.id;
        const batch = this.#batches.get(hostId) ?? {
            host: group.host.destination,
            count: 0,
            afterHostRestart: false,
            timer: undefined,
        };
        batch.count += fresh.length;
        batch.afterHostRestart ||= fresh.some((entry) => entry.afterHostRestart);
        clearTimeout(batch.timer);
        batch.timer = setTimeout(() => this.#announce(hostId), RESTORE_SETTLE_MS);
        this.#batches.set(hostId, batch);
    }

    clear(): void {
        for (const batch of this.#batches.values()) {
            clearTimeout(batch.timer);
        }
        this.#batches.clear();
    }

    #announce(hostId: string): void {
        const batch = this.#batches.get(hostId);
        this.#batches.delete(hostId);
        if (batch === undefined) {
            return;
        }
        const message = batch.afterHostRestart ? restoreAnnouncements.afterRestart : restoreAnnouncements.restored;
        const text = this.#options.intl.formatMessage(message, { host: batch.host, count: batch.count });
        this.#options.notifications.add({ text, level: 'info' });
        this.#options.announcer.announce(text, { group: `restore:${hostId}` });
    }
}
