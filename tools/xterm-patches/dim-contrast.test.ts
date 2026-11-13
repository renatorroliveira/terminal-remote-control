import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const desktop = resolve(import.meta.dirname, '../../apps/desktop/package.json');
const require = createRequire(desktop);
const HALVED_FLOOR = /minimumContrastRatio\/\((?:\w+\.isDim\(\)|\w+)\?2:1\)/;

function bundles(name: string, base: string): readonly string[] {
    const root = dirname(require.resolve(`${name}/package.json`));
    return [join(root, 'lib', `${base}.js`), join(root, 'lib', `${base}.mjs`)];
}

describe('xterm.js patches: dim text keeps the full contrast floor (A11Y-07, D-39)', () => {
    it('holds dim (SGR 2) text to the same minimum contrast as other text, in the DOM and WebGL renderers', () => {
        for (const file of [...bundles('@xterm/xterm', 'xterm'), ...bundles('@xterm/addon-webgl', 'addon-webgl')]) {
            expect(readFileSync(file, 'utf8'), file).not.toMatch(HALVED_FLOOR);
        }
    });
});
