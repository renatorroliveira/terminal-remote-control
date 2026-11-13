import { describe, expect, it } from 'vitest';
import { suggestedAddresses } from './host-suggestions';

describe('suggestedAddresses: what Add host offers (US-1.1.1)', () => {
    it('offers recent addresses first, then SSH config hosts, leaving out repeats and hosts already added', () => {
        const known = [{ id: 'host-1', address: { destination: 'devbox-1' }, installRoot: '~/.trc' }];
        expect(suggestedAddresses(['old-box', 'devbox-1'], ['devbox-1', 'build', 'old-box'], known)).toEqual([
            'old-box',
            'build',
        ]);
    });
});
