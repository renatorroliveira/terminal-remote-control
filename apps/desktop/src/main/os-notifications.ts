import type { SessionNotice } from '../shared/contract';

/** An OS notification as the main process posts it: what it shows and what it reports. */
export interface PostedNotification {
    on(event: 'click', listener: () => void): unknown;
    on(event: 'close' | 'failed', listener: () => void): unknown;
    show(): void;
}

/** The shortest time between two notifications of one session, whatever the page asks. */
export const SESSION_NOTICE_INTERVAL_MS = 10_000;
/** The most posted notifications kept for their clicks; the oldest one's click is then ignored. */
export const MAX_PENDING_NOTICES = 20;

/** What posting needs: whether the OS takes notifications, a way to build one, and what a click does. */
export interface OsNotificationOptions {
    readonly supported: () => boolean;
    readonly create: (options: {
        readonly title: string;
        readonly body: string;
        readonly silent: true;
    }) => PostedNotification;
    /** The user chose a notification: the app opens its session. */
    readonly onClick: (key: string) => void;
    /** The clock the posting is paced by. */
    readonly now?: () => number;
}

/**
 * Posts background events as OS notifications (US-5.3.1, P-76), silent because the app has its own cues. Each holds
 * a session's name, its host and the event, never terminal output. Posted ones are kept until they close, click or
 * fail, so a click still reaches the app.
 */
export class OsNotifications {
    readonly #options: OsNotificationOptions;
    readonly #posted = new Set<PostedNotification>();
    readonly #lastPosted = new Map<string, number>();

    /** Notifications posted through `options`. */
    constructor(options: OsNotificationOptions) {
        this.#options = options;
    }

    /**
     * Posts `notice`; false when the OS takes no notifications, or one of its session was posted less than
     * {@link SESSION_NOTICE_INTERVAL_MS} ago.
     */
    post(notice: SessionNotice): boolean {
        const now = this.#options.now?.() ?? Date.now();
        const last = this.#lastPosted.get(notice.key) ?? Number.NEGATIVE_INFINITY;
        if (!this.#options.supported() || now - last < SESSION_NOTICE_INTERVAL_MS) {
            return false;
        }
        this.#lastPosted.set(notice.key, now);
        const notification = this.#options.create({ title: notice.title, body: notice.body, silent: true });
        this.#posted.add(notification);
        if (this.#posted.size > MAX_PENDING_NOTICES) {
            const [oldest] = this.#posted;
            if (oldest !== undefined) {
                this.#posted.delete(oldest);
            }
        }
        const forget = (): void => {
            this.#posted.delete(notification);
        };
        notification.on('click', () => {
            forget();
            this.#options.onClick(notice.key);
        });
        notification.on('close', forget);
        notification.on('failed', forget);
        notification.show();
        return true;
    }

    /** How many posted notifications are still on screen or in the OS's list. */
    get pending(): number {
        return this.#posted.size;
    }
}
