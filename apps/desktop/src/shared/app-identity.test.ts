import { describe, expect, it } from 'vitest';
import { APP_IDENTITY } from './app-identity';

describe('APP_IDENTITY', () => {
    it('holds the working product identity in one place (P-12, OQ-5)', () => {
        expect(APP_IDENTITY).toEqual({
            productName: 'Term Remote Control',
            bundleId: 'dev.trc.desktop',
            appScheme: 'app',
            appHost: 'trc',
        });
    });
});
