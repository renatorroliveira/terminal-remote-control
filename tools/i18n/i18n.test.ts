import { describe, expect, it } from 'vitest';
import { compileArguments, extractArguments } from './i18n.ts';

describe('i18n', () => {
    it('extracts the renderer messages, without tests', () => {
        expect(extractArguments('/t/en.json')).toEqual([
            'extract',
            'src/renderer/**/*.{ts,tsx}',
            '--ignore',
            'src/renderer/**/*.test.{ts,tsx}',
            '--out-file',
            '/t/en.json',
        ]);
    });

    it('precompiles them to an AST', () => {
        expect(compileArguments('/t/en.json', '/t/out.json')).toEqual([
            'compile',
            '/t/en.json',
            '--ast',
            '--out-file',
            '/t/out.json',
        ]);
    });
});
