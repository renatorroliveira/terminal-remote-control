import { describe, expect, it } from 'vitest';
import { startedRun, unpublished } from './release.ts';

describe('the release trigger (P-21, D-42)', () => {
    it('follows the caller’s newest run created within the clock-skew window or later, and none before it', () => {
        const since = Date.parse('2026-11-13T10:00:00Z');
        const runs = [
            { databaseId: 3, createdAt: '2026-11-13T10:00:04Z' },
            { databaseId: 2, createdAt: '2026-11-13T10:00:02Z' },
            { databaseId: 1, createdAt: '2026-11-13T09:00:00Z' },
        ];
        expect(startedRun(runs, since)).toBe('3');
        expect(startedRun(runs.slice(2), since)).toBeUndefined();
        expect(startedRun([], since)).toBeUndefined();
    });

    it('fails a release run whose publish job did not succeed, but not a dry run', () => {
        expect(unpublished({ bump: 'minor', dryRun: false }, 'success')).toBeUndefined();
        expect(unpublished({ bump: 'minor', dryRun: false }, '')).toMatch(/publish job never ran/);
        expect(unpublished({ bump: 'minor', dryRun: false }, 'skipped')).toMatch(/publish job ended skipped/);
        expect(unpublished({ bump: 'minor', dryRun: true }, '')).toBeUndefined();
    });
});
