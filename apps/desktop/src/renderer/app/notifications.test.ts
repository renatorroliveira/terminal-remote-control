import { describe, expect, it } from 'vitest';
import { NotificationCenter } from './notifications';

describe('NotificationCenter: the persistent notification list (A11Y-12, TECH_STACK §4.3)', () => {
    it('keeps every notification, newest first, until the user dismisses it', () => {
        let now = 1000;
        const center = new NotificationCenter(() => now);
        center.add({ text: 'Couldn’t connect to devbox', level: 'error' });
        now = 2000;
        center.add({ text: 'build disconnected', level: 'info' });
        const [newest, oldest] = center.store.getState().items;
        expect(newest).toMatchObject({ text: 'build disconnected', level: 'info', time: 2000 });
        expect(oldest).toMatchObject({ text: 'Couldn’t connect to devbox', level: 'error', time: 1000 });
        center.dismiss(newest?.id ?? '');
        expect(center.store.getState().items.map((item) => item.text)).toEqual(['Couldn’t connect to devbox']);
        center.clear();
        expect(center.store.getState().items).toEqual([]);
    });
});
