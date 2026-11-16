import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/** The app's source, which release builds bundle, comments included. */
const SOURCE = join(import.meta.dirname, '..');
/** The one module that reads the seam's variables; release builds drop it, as nothing reaches it there (P-14). */
const SEAM_MODULE = join('main', 'test-seam.ts');

describe('test seam names in the app bundle (P-14)', () => {
    it('names no TRC_TEST_ variable outside the seam module, so release builds carry none, even in a comment', () => {
        const named = sourceFiles(SOURCE)
            .filter((file) => relative(SOURCE, file) !== SEAM_MODULE)
            .filter((file) => /TRC_TEST_[A-Z_]+/.test(readFileSync(file, 'utf8').replaceAll('__TRC_TEST_SEAM__', '')))
            .map((file) => relative(SOURCE, file));
        expect(named).toEqual([]);
    });
});

function sourceFiles(dir: string): readonly string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            return sourceFiles(path);
        }
        return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
    });
}
