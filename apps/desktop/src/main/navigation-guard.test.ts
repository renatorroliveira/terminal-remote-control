import { describe, expect, it } from 'vitest';
import { type GuardedContents, refuseNavigation } from './navigation-guard';

type NavigateListener = (event: { preventDefault(): void }, url: string) => void;

function fakeContents() {
    const listeners: NavigateListener[] = [];
    let openHandler: ((details: { url: string }) => { action: 'deny' }) | undefined;
    const contents: GuardedContents = {
        on: (_event, listener) => listeners.push(listener),
        setWindowOpenHandler: (handler) => {
            openHandler = handler;
        },
    };
    const navigate = (url: string): boolean => {
        let prevented = false;
        for (const listener of listeners) {
            listener({ preventDefault: () => (prevented = true) }, url);
        }
        return prevented;
    };
    return { contents, navigate, open: (url: string) => openHandler?.({ url }) };
}

describe('refuseNavigation', () => {
    it('keeps the main window on its page: every navigation it starts is refused (SEC-01)', () => {
        const fake = fakeContents();
        refuseNavigation(fake.contents);
        expect(fake.navigate('https://example.com/')).toBe(true);
        expect(fake.navigate('file:///etc/passwd')).toBe(true);
        expect(fake.navigate('app://trc/other.html')).toBe(true);
    });

    it('opens no new window; links open only through the link confirmation (D-38)', () => {
        const fake = fakeContents();
        refuseNavigation(fake.contents);
        expect(fake.open('https://example.com/')).toEqual({ action: 'deny' });
    });
});
