import { describe, expect, it } from 'vitest';
import { isBackgroundLaunch } from './background-launch';

describe('isBackgroundLaunch (test builds only)', () => {
    it('opens behind the focused app when a test build asks for it', () => {
        expect(isBackgroundLaunch({ seamEnabled: true, env: { TRC_TEST_BACKGROUND: '1' } })).toBe(true);
    });

    it('never applies to release builds, or without the variable', () => {
        expect(isBackgroundLaunch({ seamEnabled: false, env: { TRC_TEST_BACKGROUND: '1' } })).toBe(false);
        expect(isBackgroundLaunch({ seamEnabled: true, env: {} })).toBe(false);
    });
});
