import { describe, expect, it } from 'vitest';
import type { KnownHost } from '../../shared/hosts';
import { hostSettings } from './workspace-actions';

describe('hostSettings (US-1.4.3, A11Y-11.9, US-4.2.1)', () => {
    it('lets the user move a host’s install location or forget it', () => {
        const host: KnownHost = { id: 'host-a', address: { destination: 'devbox-1' }, installRoot: '~/.trc' };
        expect(hostSettings(host)).toEqual(['install-root', 'forget']);
    });

    it('keeps This computer, which always installs in the TRC home', () => {
        const local: KnownHost = {
            id: 'local',
            address: { destination: 'localhost' },
            installRoot: '/home/tester/.trc',
            local: true,
        };
        expect(hostSettings(local)).toEqual([]);
    });
});
