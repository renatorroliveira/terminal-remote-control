import type { SessionActivity, SessionInfo } from '@trc/protocol';
import type { IntlShape } from 'react-intl';
import type { SessionNotice } from '../../shared/contract';
import type { Settings } from '../../shared/settings';
import { stripControlCharacters } from '../../shared/text';
import type { WorkspaceController } from '../sessions/workspace-controller';
import { hostGroups, type SessionKey, sessionKey, type Workspace } from '../sessions/workspace-model';
import type { Announcer } from './announcer';
import {
    backgroundEventMessage,
    backgroundEventMessages,
    backgroundNoticeBodies,
    backgroundNoticeTitle,
} from './background-messages';
import type { NotificationCenter } from './notifications';

/** How close two bells of one session are to count as one: the daemon and the terminal may both report it. */
export const BELL_MERGE_MS = 1_000;
/**
 * The shortest time between two OS notifications of one kind for one session, so a session that keeps ringing can't
 * flood them; the in-app list keeps every one.
 */
export const NOTICE_INTERVAL_MS = 10_000;

/** The settings that decide what each background event does (US-5.3.1). */
export type BackgroundSettings = Pick<
    Settings,
    | 'longCommandSeconds'
    | 'announceBackgroundBell'
    | 'notifyBackgroundBell'
    | 'announceBackgroundEnd'
    | 'notifyBackgroundEnd'
    | 'announceBackgroundCommand'
    | 'notifyBackgroundCommand'
>;

/** Where OS notifications go; false when the OS took none. */
export interface OsNotifier {
    post(notice: SessionNotice): Promise<boolean>;
}

/** What background events are built from. */
export interface BackgroundEventsOptions {
    readonly workspace: Pick<
        WorkspaceController,
        'store' | 'recordBell' | 'recordEnded' | 'recordFinished' | 'onSessionActivity'
    >;
    readonly intl: IntlShape;
    readonly announcer: Pick<Announcer, 'announce'>;
    readonly notifications: Pick<NotificationCenter, 'add'>;
    readonly settings: () => BackgroundSettings;
    readonly os?: OsNotifier;
    readonly now: () => number;
}

type EventKind = 'bell' | 'end' | 'command';

type EventMessages = typeof backgroundEventMessages | typeof backgroundNoticeBodies;

interface BackgroundEvent {
    readonly kind: EventKind;
    readonly key: SessionKey;
    readonly exitCode: number | undefined;
}

const LIVE: ReadonlySet<SessionInfo['state']> = new Set(['starting', 'running']);
/** Ends the restore report already tells of: a host restart, or processes that ended with the user's login. */
const REPORTED_ENDS: ReadonlySet<string> = new Set(['hostRestart', 'processesEnded']);
const ENDED: ReadonlySet<SessionInfo['state']> = new Set(['exited', 'failedToStart']);

/**
 * Events in sessions that aren't open (US-5.3): a bell, a process that ends, and a long command that finishes. Each
 * badges its row until the session is viewed, and is announced politely, merged per session (A11Y-12.3), and posted
 * as an OS notification (also kept in the in-app list), each as the settings say. A session the user stopped is not
 * an event. OS notifications hold the session's own name or shell, never a title a program set (P-76).
 */
export class BackgroundEvents {
    readonly #options: BackgroundEventsOptions;
    readonly #lastBell = new Map<SessionKey, number>();
    readonly #lastNotice = new Map<string, number>();

    /** Background events over `options`; {@link BackgroundEvents.start} starts watching. */
    constructor(options: BackgroundEventsOptions) {
        this.#options = options;
    }

    /** Watches the daemons' activity and the sessions' states; returns the stop. */
    start(): () => void {
        const { workspace } = this.#options;
        const stopActivity = workspace.onSessionActivity((key, activity) => this.#activity(key, activity));
        const stopStates = workspace.store.subscribe((after, before) => this.#statesChanged(after, before));
        return () => {
            stopActivity();
            stopStates();
        };
    }

    /** A session's bell, from its daemon or its terminal; ignored while the session is open, which has its own. */
    bell(key: SessionKey): void {
        const now = this.#options.now();
        const last = this.#lastBell.get(key) ?? Number.NEGATIVE_INFINITY;
        if (this.#isOpen(key) || now - last < BELL_MERGE_MS) {
            return;
        }
        this.#lastBell.set(key, now);
        this.#options.workspace.recordBell(key);
        this.#report({ kind: 'bell', key, exitCode: undefined });
    }

    #activity(key: SessionKey, activity: SessionActivity): void {
        if (activity.type === 'bell') {
            this.bell(key);
            return;
        }
        const long = activity.durationMs >= this.#options.settings().longCommandSeconds * 1_000;
        if (long && !this.#isOpen(key)) {
            this.#options.workspace.recordFinished(key);
            this.#report({ kind: 'command', key, exitCode: activity.exitCode });
        }
    }

    #statesChanged(after: Workspace, before: Workspace): void {
        for (const host of after.hosts) {
            const was = new Map((before.sessions.get(host.id) ?? []).map((session) => [session.id, session.state]));
            for (const session of after.sessions.get(host.id) ?? []) {
                const key = sessionKey(host.id, session.id);
                if (key !== after.open && justEnded(was.get(session.id), session)) {
                    this.#options.workspace.recordEnded(key);
                    this.#report({ kind: 'end', key, exitCode: session.exit?.code });
                }
            }
        }
    }

    #report(event: BackgroundEvent): void {
        const found = this.#find(event.key);
        if (found === undefined) {
            return;
        }
        const { intl, announcer, settings } = this.#options;
        const what = this.#eventText(event, backgroundEventMessages);
        const text = intl.formatMessage(backgroundEventMessage, {
            session: found.label,
            host: found.host,
            event: what,
        });
        const wanted = wantedFor(settings(), event.kind);
        if (wanted.announce) {
            announcer.announce(text, { group: `bg:${event.key}` });
        }
        if (wanted.notify) {
            this.#options.notifications.add({ text, level: 'info' });
        }
        if (wanted.notify && this.#noticeDue(event)) {
            const title = intl.formatMessage(backgroundNoticeTitle, { session: found.ownName, host: found.host });
            const body = this.#eventText(event, backgroundNoticeBodies);
            void this.#options.os?.post({ title, body, key: event.key }).catch(() => false);
        }
    }

    #noticeDue(event: BackgroundEvent): boolean {
        const now = this.#options.now();
        const kind = `${event.key}\n${event.kind}`;
        if (now - (this.#lastNotice.get(kind) ?? Number.NEGATIVE_INFINITY) < NOTICE_INTERVAL_MS) {
            return false;
        }
        this.#lastNotice.set(kind, now);
        return true;
    }

    #eventText(event: BackgroundEvent, messages: EventMessages): string {
        const { intl } = this.#options;
        const code = event.exitCode;
        switch (event.kind) {
            case 'bell':
                return intl.formatMessage(messages.bell);
            case 'end':
                return code === undefined
                    ? intl.formatMessage(messages.ended)
                    : intl.formatMessage(messages.endedWithCode, { code });
            case 'command':
                return code === undefined
                    ? intl.formatMessage(messages.command)
                    : intl.formatMessage(messages.commandWithCode, { code });
        }
    }

    #find(key: SessionKey): { readonly label: string; readonly ownName: string; readonly host: string } | undefined {
        for (const group of hostGroups(this.#options.workspace.store.getState())) {
            const item = group.sessions.find((entry) => entry.key === key);
            if (item !== undefined) {
                const ownName = stripControlCharacters(item.session.customName ?? item.session.profile.name);
                return { label: item.label, ownName, host: group.host.destination };
            }
        }
        return undefined;
    }

    #isOpen(key: SessionKey): boolean {
        return this.#options.workspace.store.getState().open === key;
    }
}

/** Whether a session last seen live has now ended, by itself and not as a restore reports. */
function justEnded(previous: SessionInfo['state'] | undefined, session: SessionInfo): boolean {
    const reported = REPORTED_ENDS.has(session.exit?.ended ?? '');
    return previous !== undefined && LIVE.has(previous) && ENDED.has(session.state) && !reported;
}

function wantedFor(
    settings: BackgroundSettings,
    kind: EventKind,
): { readonly announce: boolean; readonly notify: boolean } {
    switch (kind) {
        case 'bell':
            return { announce: settings.announceBackgroundBell, notify: settings.notifyBackgroundBell };
        case 'end':
            return { announce: settings.announceBackgroundEnd, notify: settings.notifyBackgroundEnd };
        case 'command':
            return { announce: settings.announceBackgroundCommand, notify: settings.notifyBackgroundCommand };
    }
}
