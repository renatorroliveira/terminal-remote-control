import { describe, expect, it } from 'vitest';
import { onLocalClock } from './daemon-details';

const DETAILS = { home: '/home/me', installRoot: '/home/me/.trc', logDir: '/home/me/.trc/logs' } as const;

describe('onLocalClock', () => {
    it('dates the daemon’s start by this computer’s clock from how long it had run, whatever the host’s clock says', () => {
        expect(onLocalClock({ ...DETAILS, startedAt: 5_000_000, uptimeMs: 90_000 }, 1_000_000)).toEqual({
            ...DETAILS,
            startedAt: 910_000,
        });
    });

    it('keeps the host’s start time from a daemon that does not say how long it has run', () => {
        expect(onLocalClock({ ...DETAILS, startedAt: 5_000 }, 1_000_000)).toEqual({ ...DETAILS, startedAt: 5_000 });
    });
});
