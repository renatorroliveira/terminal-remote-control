import { describe, expect, it } from 'vitest';
import { connectionHostInit } from './connection-host-init';

const base = {
    userData: '/data/app support/Terminal Remote Control',
    resources: '/App/Resources',
    appVersion: '0.1.0',
};

describe('connectionHostInit', () => {
    it('passes the paths and version without any test seam in release builds (P-14)', () => {
        const env = { TRC_TEST_SSH_CONFIG: '/t/ssh_config', TRC_TEST_KNOWN_HOSTS: '/t/known_hosts' };
        expect(connectionHostInit({ ...base, env, seamEnabled: false })).toEqual({ type: 'init', ...base });
    });

    it('adds the seam in test builds when both variables are set', () => {
        const env = { TRC_TEST_SSH_CONFIG: '/t/ssh_config', TRC_TEST_KNOWN_HOSTS: '/t/known_hosts' };
        expect(connectionHostInit({ ...base, env, seamEnabled: true })).toEqual({
            type: 'init',
            ...base,
            seam: { sshConfig: '/t/ssh_config', knownHosts: '/t/known_hosts' },
        });
        expect(connectionHostInit({ ...base, env: { TRC_TEST_SSH_CONFIG: '/t' }, seamEnabled: true })).toEqual({
            type: 'init',
            ...base,
        });
    });
});
