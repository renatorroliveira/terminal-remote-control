import { createStore, type StoreApi } from 'zustand/vanilla';

/** The most notifications the list keeps; past it, the oldest informational one leaves before any error. */
export const MAX_NOTIFICATIONS = 200;
/** The most errors the list keeps, so even a flood of failures stays bounded. */
const MAX_ERRORS = 1_000;

/** How serious a notification is. */
export type NotificationLevel = 'info' | 'error';

/** A notification as the app posts it. */
export interface NewNotification {
    readonly text: string;
    readonly level: NotificationLevel;
}

/** A notification in the list. */
export interface AppNotification extends NewNotification {
    readonly id: string;
    /** When it was posted, in milliseconds since the epoch. */
    readonly time: number;
}

/** The notification list, newest first. */
export interface NotificationState {
    readonly items: readonly AppNotification[];
}

/**
 * The persistent notification list the status bar opens (TECH_STACK §4.3): connection failures and losses stay in
 * it until the user dismisses them, so nothing a user must know disappears on its own (A11Y-11, A11Y-12).
 */
export class NotificationCenter {
    readonly store: StoreApi<NotificationState> = createStore<NotificationState>(() => ({ items: [] }));
    readonly #now: () => number;
    #next = 0;

    /** Creates an empty list; `now` stamps each notification. */
    constructor(now: () => number = Date.now) {
        this.#now = now;
    }

    /** Posts a notification at the top of the list, within {@link MAX_NOTIFICATIONS}. */
    add(notification: NewNotification): void {
        const item: AppNotification = { ...notification, id: `notification-${this.#next++}`, time: this.#now() };
        this.store.setState((state) => ({ items: withinLimit([item, ...state.items]) }));
    }

    /** Removes one notification. */
    dismiss(id: string): void {
        this.store.setState((state) => ({ items: state.items.filter((item) => item.id !== id) }));
    }

    /** Removes every notification. */
    clear(): void {
        this.store.setState({ items: [] });
    }
}

function withinLimit(items: readonly AppNotification[]): readonly AppNotification[] {
    if (items.length <= MAX_NOTIFICATIONS) {
        return items;
    }
    const oldestInfo = items.findLastIndex((item) => item.level === 'info');
    if (oldestInfo !== -1) {
        return items.filter((_, index) => index !== oldestInfo);
    }
    return items.length > MAX_ERRORS ? items.slice(0, MAX_ERRORS) : items;
}
