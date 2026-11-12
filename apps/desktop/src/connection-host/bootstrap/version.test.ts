import { describe, expect, it } from 'vitest';
import { compareVersions } from './version';

describe('compareVersions', () => {
    it.each([
        ['0.1.0', '0.1.0', 0],
        ['0.1.0', '0.2.0', -1],
        ['0.10.0', '0.9.9', 1],
        ['1.0.0', '0.99.99', 1],
        ['2.0', '2.0.0', 0],
        ['2.0.1', '2.0', 1],
    ] as const)('compares %s with %s as %d', (left, right, expected) => {
        expect(compareVersions(left, right)).toBe(expected);
    });

    it('returns undefined when either side is not a numeric version', () => {
        expect(compareVersions('0.1.0-dev', '0.1.0')).toBeUndefined();
        expect(compareVersions('0.1.0', 'x')).toBeUndefined();
    });
});
