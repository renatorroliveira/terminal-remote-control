import { describe, expect, it } from 'vitest';
import { parseInit } from './init';

describe('parseInit', () => {
    it('accepts the init message from the main process', () => {
        const init = { type: 'init', userData: '/u', resources: '/r', appVersion: '0.1.0' };
        expect(parseInit(init)).toEqual(init);
        const seamed = { ...init, seam: { sshConfig: '/t/ssh_config', knownHosts: '/t/known_hosts' } };
        expect(parseInit(seamed)).toEqual(seamed);
    });

    it('refuses anything else', () => {
        expect(parseInit({ type: 'init', userData: '/u' })).toBeUndefined();
        expect(parseInit({ type: 'port' })).toBeUndefined();
    });
});
