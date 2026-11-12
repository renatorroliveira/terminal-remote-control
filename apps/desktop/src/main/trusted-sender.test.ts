import { describe, expect, it } from 'vitest';
import { isAppPage } from './trusted-sender';

describe('isAppPage', () => {
    it('trusts only the app scheme, and the dev server in development', () => {
        expect(isAppPage('app://trc/index.html', undefined)).toBe(true);
        expect(isAppPage('app://other/index.html', undefined)).toBe(false);
        expect(isAppPage('https://example.com/', undefined)).toBe(false);
        expect(isAppPage('http://127.0.0.1:5173/', 'http://127.0.0.1:5173')).toBe(true);
        expect(isAppPage('http://127.0.0.1:5174/', 'http://127.0.0.1:5173')).toBe(false);
        expect(isAppPage(undefined, undefined)).toBe(false);
        expect(isAppPage('not a url', undefined)).toBe(false);
    });
});
