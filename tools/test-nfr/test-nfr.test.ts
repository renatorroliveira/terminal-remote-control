import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RESULTS } from '../../apps/desktop/test/nfr/stats.ts';
import { nfrSteps, overallStatus, resultsFile } from './test-nfr.ts';

describe('test-nfr: both NFR suites in one run on any shell (D-60)', () => {
    it('runs vitest, then Playwright from the desktop package, each by its JS entry', () => {
        const root = resolve('/repo');
        const [vitest, playwright] = nfrSteps(root);
        expect(vitest?.args.slice(1)).toEqual(['run', '--project', 'nfr']);
        expect(vitest?.args[0]).toBe(resolve(root, 'node_modules/vitest/vitest.mjs'));
        expect(playwright?.cwd).toBe(resolve(root, 'apps/desktop'));
        expect(playwright?.args.slice(1)).toEqual(['test', '-c', 'playwright.nfr.config.ts']);
    });

    it('clears the file the measurements are recorded in', () => {
        expect(resultsFile(resolve(import.meta.dirname, '../..'))).toBe(RESULTS);
    });

    it('fails when either suite fails, or could not start', () => {
        expect(overallStatus([0, 0])).toBe(0);
        expect(overallStatus([1, 0])).toBe(1);
        expect(overallStatus([0, 2])).toBe(2);
        expect(overallStatus([0, null])).toBe(1);
    });
});
