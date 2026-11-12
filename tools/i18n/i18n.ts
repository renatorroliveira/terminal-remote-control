/**
 * Extracts the renderer's UI messages to `apps/desktop/lang/en.json` and precompiles them to
 * `src/renderer/i18n/compiled/en.json` (NFR-13). With `--check`, it compares fresh output with the committed files
 * instead and fails when they differ. Run through `pnpm --filter @trc/desktop i18n` or `i18n:check`.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SOURCES = 'src/renderer/**/*.{ts,tsx}';
const TESTS = 'src/renderer/**/*.test.{ts,tsx}';
const EXTRACTED = 'lang/en.json';
const COMPILED = 'src/renderer/i18n/compiled/en.json';

/** The `formatjs extract` arguments. */
export function extractArguments(outFile: string): string[] {
    return ['extract', SOURCES, '--ignore', TESTS, '--out-file', outFile];
}

/** The `formatjs compile` arguments. */
export function compileArguments(inFile: string, outFile: string): string[] {
    return ['compile', inFile, '--ast', '--out-file', outFile];
}

function generate(desktop: string, extracted: string, compiled: string): void {
    const formatjs = join(desktop, 'node_modules/.bin/formatjs');
    execFileSync(formatjs, extractArguments(extracted), { cwd: desktop, stdio: ['ignore', 'inherit', 'inherit'] });
    execFileSync(formatjs, compileArguments(extracted, compiled), {
        cwd: desktop,
        stdio: ['ignore', 'inherit', 'inherit'],
    });
}

function same(left: string, right: string): boolean {
    return readFileSync(left, 'utf8') === readFileSync(right, 'utf8');
}

if (import.meta.main) {
    const desktop = process.cwd();
    if (process.argv.includes('--check')) {
        const scratch = mkdtempSync(join(tmpdir(), 'trc-i18n-'));
        generate(desktop, join(scratch, 'en.json'), join(scratch, 'compiled.json'));
        const current =
            same(join(scratch, 'en.json'), join(desktop, EXTRACTED)) &&
            same(join(scratch, 'compiled.json'), join(desktop, COMPILED));
        if (!current) {
            console.error('UI messages changed: run pnpm --filter @trc/desktop i18n');
        }
        process.exitCode = current ? 0 : 1;
    } else {
        generate(desktop, join(desktop, EXTRACTED), join(desktop, COMPILED));
    }
}
