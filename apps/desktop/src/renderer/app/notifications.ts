import { createStore, type StoreApi } from 'zustand/vanilla';

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

    /** Posts a notification at the top of the list. */
    add(notification: NewNotification): void {
        const item: AppNotification = { ...notification, id: `notification-${this.#next++}`, time: this.#now() };
        this.store.setState((state) => ({ items: [item, ...state.items] }));
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
