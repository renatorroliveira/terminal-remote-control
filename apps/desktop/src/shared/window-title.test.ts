import { describe, expect, it } from 'vitest';
import { windowTitle } from './window-title';

describe('windowTitle (A11Y-01.5)', () => {
    it('names the active session, its host and the app', () => {
        expect(windowTitle({ session: 'build', host: 'devbox-1' })).toBe('build — devbox-1 — Term Remote Control');
    });

    it('is the app name alone without an active session', () => {
        expect(windowTitle(undefined)).toBe('Term Remote Control');
    });

    it('strips control characters a program title could carry (SEC-06.4)', () => {
        expect(windowTitle({ session: 'a\u001b]0;evil\u0007b', host: 'h' })).toBe(
            'a]0;evilb — h — Term Remote Control',
        );
    });
});
