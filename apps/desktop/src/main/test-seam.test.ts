import { describe, expect, it } from 'vitest';
import { NO_TEST_SEAM, readTestSeam } from './test-seam';

describe('readTestSeam (P-14, test builds only)', () => {
    it('reads every TRC_TEST_ variable into typed values', () => {
        expect(
            readTestSeam({
                TRC_TEST_BACKGROUND: '1',
                TRC_TEST_SSH_CONFIG: '/t/ssh_config',
                TRC_TEST_KNOWN_HOSTS: '/t/known_hosts',
                TRC_TEST_INSTALL_ROOT: '~/.trc-e2e-1a2b',
                TRC_TEST_OPENED_LINKS: '/t/opened.log',
            }),
        ).toEqual({
            background: true,
            sshConfig: '/t/ssh_config',
            knownHosts: '/t/known_hosts',
            installRoot: '~/.trc-e2e-1a2b',
            openedLinks: '/t/opened.log',
        });
    });

    it('leaves out what is unset or empty, and opens in front unless asked', () => {
        expect(readTestSeam({ TRC_TEST_BACKGROUND: '0', TRC_TEST_SSH_CONFIG: '' })).toEqual(NO_TEST_SEAM);
        expect(readTestSeam({})).toEqual({ background: false });
    });

    it('is empty in release builds, which never call readTestSeam', () => {
        expect(NO_TEST_SEAM).toEqual({ background: false });
    });
});
