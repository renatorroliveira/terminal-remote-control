import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/** The app's source, which release builds bundle, comments included, with its page, styles and messages. */
const SOURCE = join(import.meta.dirname, '..');
/** The one module that reads the seam's variables; release builds drop all of it, as nothing reaches it (P-14). */
const SEAM_MODULE = join('main', 'test-seam-reader.ts');
/** The files a build takes from the source: modules, the page, styles and compiled messages. */
const BUNDLED = /\.(tsx?|html|css|json)$/;
/** What `pnpm verify:artifact` refuses anywhere in a release bundle (`tools/verify-artifact/checks.ts`). */
const SEAM_NAME = /TRC_TEST_[A-Z_]+/;
/** Block and line comments, which the bundle keeps as they are. */
const COMMENT = /\/\*[\s\S]*?\*\/|\/\/.*$/gm;
/** The build flag in code, which the build replaces with `true` or `false` (`electron.vite.config.ts`). */
const BUILD_FLAG = /\b__TRC_TEST_SEAM__\b/g;

describe('test seam names in the app bundle (P-14)', () => {
    it('names no TRC_TEST_ variable outside the seam reader, so release builds carry none, even in a comment', () => {
        const named = sourceFiles(SOURCE)
            .filter((file) => relative(SOURCE, file) !== SEAM_MODULE)
            .filter((file) => namesSeam(readFileSync(file, 'utf8')))
            .map((file) => relative(SOURCE, file));
        expect(named).toEqual([]);
    });

    it('allows the build flag in code, which the build replaces', () => {
        expect(namesSeam('if (__TRC_TEST_SEAM__) {\n    run();\n}')).toBe(false);
        expect(namesSeam('const seam = __TRC_TEST_SEAM__ ? read() : NONE;')).toBe(false);
    });

    it('refuses the build flag in a comment, which the bundle keeps and the artifact check refuses', () => {
        expect(namesSeam('/** Dropped by `__TRC_TEST_SEAM__` in release builds. */\nexport const a = 1;')).toBe(true);
        expect(namesSeam('const a = 1; // see __TRC_TEST_SEAM__')).toBe(true);
    });

    it('refuses any other seam name, in code or in a comment', () => {
        expect(namesSeam("const name = 'TRC_TEST_HOME';")).toBe(true);
        expect(namesSeam('/* TRC_TEST_BACKGROUND opens unseen */')).toBe(true);
    });
});

/** Whether `text` holds a seam name that a release bundle would carry: in any comment, or in code but the build flag. */
function namesSeam(text: string): boolean {
    const comments = text.match(COMMENT)?.join('\n') ?? '';
    const code = text.replace(COMMENT, '').replace(BUILD_FLAG, '');
    return SEAM_NAME.test(comments) || SEAM_NAME.test(code);
}

function sourceFiles(dir: string): readonly string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            return sourceFiles(path);
        }
        return BUNDLED.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
    });
}
