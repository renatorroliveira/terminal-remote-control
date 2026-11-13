/**
 * Prints the measurements of the last `pnpm test:nfr` run (apps/desktop/nfr-results/results.jsonl) as a
 * Markdown table, one row per measurement in run order, for docs/verification/E1-nfr.md (ST-19).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** One recorded measurement. */
export interface Measurement {
    readonly id: string;
    readonly what: string;
    readonly value: number;
    readonly unit: string;
    readonly target: string;
}

/** The Markdown table of `measurements`, values rounded for reading: one decimal, none at 100 and above. */
export function measurementTable(measurements: readonly Measurement[]): string {
    const rows = measurements.map(
        ({ id, what, value, unit, target }) =>
            `| ${id} | ${what.replaceAll('|', '\\|')} | ${rounded(value)} ${unit} | ${target} |`,
    );
    return ['| ID | Measurement | Value | Target |', '| --- | --- | --- | --- |', ...rows].join('\n');
}

function rounded(value: number): string {
    return Math.abs(value) >= 100 ? Math.round(value).toLocaleString('en-US') : value.toFixed(1);
}

if (import.meta.main) {
    const file = resolve(import.meta.dirname, '../../apps/desktop/nfr-results/results.jsonl');
    const measurements = readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as Measurement);
    process.stdout.write(`${measurementTable(measurements)}\n`);
}
