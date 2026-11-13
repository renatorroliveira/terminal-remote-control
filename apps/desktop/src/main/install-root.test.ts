import { describe, expect, it } from 'vitest';
import { installRootFor } from './install-root';

describe('installRootFor: where new hosts install the daemon', () => {
    it('is ~/.trc on every host', () => {
        expect(installRootFor(undefined)).toBe('~/.trc');
    });

    it('is the test install root in test builds, so e2e runs never touch a real install (P-14)', () => {
        expect(installRootFor('~/.trc-e2e-1a2b')).toBe('~/.trc-e2e-1a2b');
    });

    it('refuses a test root that is not one folder under the remote home', () => {
        expect(installRootFor('/tmp/elsewhere')).toBe('~/.trc');
        expect(installRootFor('~/a/../b')).toBe('~/.trc');
    });
});
