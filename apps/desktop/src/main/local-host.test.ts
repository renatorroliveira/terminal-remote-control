import { describe, expect, it } from 'vitest';
import { localHostRoot } from './local-host';

describe('localHostRoot (US-4.1, P-56, P-58)', () => {
    it('gives every Mac This computer, installing in the TRC home', () => {
        expect(
            localHostRoot({ platform: 'darwin', testBuild: false, seam: { background: false }, home: '/h/.trc' }),
        ).toBe('/h/.trc');
    });

    it('has none before the desktop platforms with a local daemon arrive (PRD §7.4)', () => {
        expect(
            localHostRoot({ platform: 'linux', testBuild: false, seam: { background: false }, home: '/h/.trc' }),
        ).toBe(undefined);
    });

    it('has a test build show This computer only to tests that give its daemon a scratch home', () => {
        const home = '/tmp/scratch/home';
        expect(localHostRoot({ platform: 'darwin', testBuild: true, seam: { background: false }, home })).toBe(
            undefined,
        );
        const seam = { background: false, localHome: '/tmp/scratch/local-home' };
        expect(localHostRoot({ platform: 'darwin', testBuild: true, seam, home })).toBe(home);
    });
});
