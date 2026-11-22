/**
 * The second half of `pnpm test:nfr`: the vitest NFR project, then the Playwright NFR specs, the second even when the
 * first fails, so one run records every measurement; it fails when either does. A `;` between the two in
 * package.json would mean nothing to cmd.exe on Windows (D-60). It starts by deleting the previous run's results, so
 * `tools/nfr-report` prints this run's alone.
 */
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

/** A step: what it runs and in which folder. */
export interface Step {
    readonly args: readonly string[];
    readonly cwd: string;
}

/** The two NFR suites, each run by its package's own JS entry with this Node, never a `.cmd` shim. */
export function nfrSteps(root: string): readonly Step[] {
    const desktop = resolve(root, 'apps/desktop');
    return [
        { args: [resolve(root, 'node_modules/vitest/vitest.mjs'), 'run', '--project', 'nfr'], cwd: root },
        {
            args: [resolve(desktop, 'node_modules/@playwright/test/cli.js'), 'test', '-c', 'playwright.nfr.config.ts'],
            cwd: desktop,
        },
    ];
}

/** The file every NFR measurement of a run is appended to (`apps/desktop/test/nfr/stats.ts`). */
export function resultsFile(root: string): string {
    return resolve(root, 'apps/desktop/nfr-results/results.jsonl');
}

/** The exit code of the whole run: the first failure's, or 0. */
export function overallStatus(statuses: readonly (number | null)[]): number {
    return statuses.map((status) => status ?? 1).find((status) => status !== 0) ?? 0;
}

if (import.meta.main) {
    const root = resolve(import.meta.dirname, '../..');
    rmSync(resultsFile(root), { force: true });
    const statuses = nfrSteps(root).map(
        ({ args, cwd }) => spawnSync(process.execPath, args, { cwd, stdio: 'inherit', windowsHide: true }).status,
    );
    process.exitCode = overallStatus(statuses);
}
