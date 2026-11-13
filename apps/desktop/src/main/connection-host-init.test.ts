import { describe, expect, it } from 'vitest';
import { connectionHostInit } from './connection-host-init';

const base = {
    userData: '/data/app support/Terminal Remote Control',
    resources: '/App/Resources',
    appVersion: '0.1.0',
};

describe('connectionHostInit', () => {
    it('passes the paths and version without any test seam in release builds (P-14)', () => {
        expect(connectionHostInit({ ...base, seam: { background: false } })).toEqual({ type: 'init', ...base });
    });

    it('adds the seam in test builds when both files are set', () => {
        const seam = { background: false, sshConfig: '/t/ssh_config', knownHosts: '/t/known_hosts' };
        expect(connectionHostInit({ ...base, seam })).toEqual({
            type: 'init',
            ...base,
            seam: { sshConfig: '/t/ssh_config', knownHosts: '/t/known_hosts' },
        });
        expect(connectionHostInit({ ...base, seam: { background: false, sshConfig: '/t' } })).toEqual({
            type: 'init',
            ...base,
        });
    });
});
