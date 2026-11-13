import { afterEach, describe, expect, it } from 'vitest';
import { reportWriteTiming, type WriteTiming } from './write-timing';

const probe = globalThis as { __trcWriteTimings?: WriteTiming[] };

afterEach(() => {
    delete probe.__trcWriteTimings;
});

describe('reportWriteTiming (P-14, ST-19)', () => {
    it('hands each parsed write to a test that asked for timings', () => {
        probe.__trcWriteTimings = [];
        reportWriteTiming(10, 12.5, 3);
        expect(probe.__trcWriteTimings).toEqual([{ arrived: 10, parsed: 12.5, bytes: 3 }]);
    });

    it('does nothing when no test is listening', () => {
        reportWriteTiming(10, 12.5, 3);
        expect(probe.__trcWriteTimings).toBeUndefined();
    });
});
