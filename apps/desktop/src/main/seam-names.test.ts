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
/** A module's comments and string literals, which the bundle keeps as they are. */
const KEPT_AS_IS = /\/\*[\s\S]*?\*\/|\/\/.*$|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/gm;
/** The build flag in a module's code, which the build replaces with `true` or `false` (`electron.vite.config.ts`). */
const BUILD_FLAG = /\b__TRC_TEST_SEAM__\b/g;
/** The source files the build compiles; the page, styles and messages go into the bundle untouched. */
const MODULE = /\.tsx?$/;

describe('test seam names in the app bundle (P-14)', () => {
    it('names no TRC_TEST_ variable outside the seam reader, so release builds carry none, even in a comment', () => {
        const named = sourceFiles(SOURCE)
            .filter((file) => relative(SOURCE, file) !== SEAM_MODULE)
            .filter((file) => namesSeam(readFileSync(file, 'utf8'), MODULE.test(file)))
            .map((file) => relative(SOURCE, file));
        expect(named).toEqual([]);
    });

    it('allows the build flag in the code of a module, which the build replaces', () => {
        expect(namesSeam('if (__TRC_TEST_SEAM__) {\n    run();\n}', true)).toBe(false);
        expect(namesSeam('const seam = __TRC_TEST_SEAM__ ? read() : NONE;', true)).toBe(false);
    });

    it('refuses the build flag in a comment or a string, which the bundle keeps and the artifact check refuses', () => {
        expect(namesSeam('/** Dropped by `__TRC_TEST_SEAM__` in release builds. */\nexport const a = 1;', true)).toBe(
            true,
        );
        expect(namesSeam('const a = 1; // see __TRC_TEST_SEAM__', true)).toBe(true);
        expect(namesSeam('const s = "__TRC_TEST_SEAM__";', true)).toBe(true);
        expect(namesSeam('const s = `flag: __TRC_TEST_SEAM__`;', true)).toBe(true);
    });

    it('refuses the build flag anywhere in the page, styles or messages, which the build does not touch', () => {
        expect(namesSeam('<!-- gated by __TRC_TEST_SEAM__ -->', false)).toBe(true);
        expect(namesSeam('{"a":"__TRC_TEST_SEAM__"}', false)).toBe(true);
    });

    it('refuses any other seam name, in code or in a comment', () => {
        expect(namesSeam("const name = 'TRC_TEST_HOME';", true)).toBe(true);
        expect(namesSeam('/* TRC_TEST_BACKGROUND opens unseen */', true)).toBe(true);
    });
});

/**
 * Whether `text` holds a seam name a release bundle would carry: anywhere in a file the build leaves as it is, and in
 * a module's comments, strings and code, but for the build flag in its code.
 */
function namesSeam(text: string, module: boolean): boolean {
    if (!module) {
        return SEAM_NAME.test(text);
    }
    const kept = text.match(KEPT_AS_IS)?.join('\n') ?? '';
    const code = text.replace(KEPT_AS_IS, '').replace(BUILD_FLAG, '');
    return SEAM_NAME.test(kept) || SEAM_NAME.test(code);
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
