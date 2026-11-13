import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** Where every NFR measurement is appended, one JSON object per line, for docs/verification/E1-nfr.md. */
export const RESULTS = resolve(import.meta.dirname, '../../test-results/nfr/results.jsonl');

/** The `p`th percentile (0 to 100) of `values`, by the nearest-rank method. */
export function percentile(values: readonly number[], p: number): number {
    if (values.length === 0) {
        throw new Error('no values');
    }
    const sorted = [...values].sort((a, b) => a - b);
    const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
    return sorted[rank - 1] ?? Number.NaN;
}

/** Records one measurement with its target, so the results document lists what was measured and against what. */
export function record(measurement: {
    readonly id: string;
    readonly what: string;
    readonly value: number;
    readonly unit: string;
    readonly target: string;
}): void {
    mkdirSync(dirname(RESULTS), { recursive: true });
    appendFileSync(RESULTS, `${JSON.stringify({ ...measurement, at: new Date().toISOString() })}\n`);
}

/** The results folder, for files a test writes beside the measurements. */
export const RESULTS_FOLDER = join(dirname(RESULTS));
