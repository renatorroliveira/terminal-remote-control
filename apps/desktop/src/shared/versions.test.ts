import { describe, expect, it } from 'vitest';
import { isOlderVersion } from './versions';

describe('isOlderVersion (D-46, US-3.3.2)', () => {
    it('compares the numbers in order, a pre-release before its release, as the daemon does', () => {
        expect(isOlderVersion('0.3.0', '0.4.0')).toBe(true);
        expect(isOlderVersion('0.4.0', '0.4.0')).toBe(false);
        expect(isOlderVersion('0.10.0', '0.9.9')).toBe(false);
        expect(isOlderVersion('0.4.0-dev', '0.4.0')).toBe(true);
        expect(isOlderVersion('0.4.0', '0.4.0-dev')).toBe(false);
        expect(isOlderVersion('1.0', '1.0.0')).toBe(false);
    });

    it('never calls a version it cannot read older', () => {
        expect(isOlderVersion('garbage', '0.4.0')).toBe(false);
        expect(isOlderVersion('0.3.0', 'x.y')).toBe(false);
    });
});
