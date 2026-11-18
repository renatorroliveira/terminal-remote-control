import { describe, expect, it } from 'vitest';
import { OsNotifications, type PostedNotification } from './os-notifications';

class FakeNotification implements PostedNotification {
    readonly listeners = new Map<string, () => void>();
    readonly options: { readonly title: string; readonly body: string; readonly silent: true };
    shown = false;

    constructor(options: { readonly title: string; readonly body: string; readonly silent: true }) {
        this.options = options;
    }

    on(event: string, listener: () => void): this {
        this.listeners.set(event, listener);
        return this;
    }

    show(): void {
        this.shown = true;
    }
}

function setUp(supported = true) {
    const created: FakeNotification[] = [];
    const clicked: string[] = [];
    const notifications = new OsNotifications({
        supported: () => supported,
        create: (options) => {
            const notification = new FakeNotification(options);
            created.push(notification);
            return notification;
        },
        onClick: (key) => clicked.push(key),
    });
    return { notifications, created, clicked };
}

const NOTICE = { title: 'build on devbox-1', body: 'Command finished, exit code 1.', key: 'host-1/s1' };

describe('OsNotifications: background events as OS notifications (US-5.3.1, P-76)', () => {
    it('shows a silent notification with the title and body, and opens its session when chosen', () => {
        const { notifications, created, clicked } = setUp();
        expect(notifications.post(NOTICE)).toBe(true);
        expect(created[0]?.options).toEqual({ title: NOTICE.title, body: NOTICE.body, silent: true });
        expect(created[0]?.shown).toBe(true);
        expect(notifications.pending).toBe(1);
        created[0]?.listeners.get('click')?.();
        expect(clicked).toEqual(['host-1/s1']);
        expect(notifications.pending).toBe(0);
    });

    it('lets go of a notification that closed or failed, and posts none where the OS takes none', () => {
        const { notifications, created } = setUp();
        notifications.post(NOTICE);
        notifications.post(NOTICE);
        created[0]?.listeners.get('close')?.();
        created[1]?.listeners.get('failed')?.();
        expect(notifications.pending).toBe(0);
        const unsupported = setUp(false);
        expect(unsupported.notifications.post(NOTICE)).toBe(false);
        expect(unsupported.created).toEqual([]);
    });
});
