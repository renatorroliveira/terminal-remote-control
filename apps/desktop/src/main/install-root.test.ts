import { describe, expect, it } from 'vitest';
import { installRootFor } from './install-root';

describe('installRootFor: where new hosts install the daemon', () => {
    it('is ~/.trc on every host', () => {
        expect(installRootFor({ seamEnabled: false, env: { TRC_TEST_INSTALL_ROOT: '~/.trc-e2e' } })).toBe('~/.trc');
        expect(installRootFor({ seamEnabled: true, env: {} })).toBe('~/.trc');
    });

    it('is the test install root in test builds, so e2e runs never touch a real install (P-14)', () => {
        expect(installRootFor({ seamEnabled: true, env: { TRC_TEST_INSTALL_ROOT: '~/.trc-e2e-1a2b' } })).toBe(
            '~/.trc-e2e-1a2b',
        );
    });
});
