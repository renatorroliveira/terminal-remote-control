import { describe, expect, it } from 'vitest';
import { CONTENT_SECURITY_POLICY, secureWebPreferences } from './security';

describe('secureWebPreferences', () => {
    it('isolates and sandboxes every renderer (TECH_STACK §4.2)', () => {
        expect(secureWebPreferences('/app/out/preload/index.cjs')).toEqual({
            preload: '/app/out/preload/index.cjs',
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            nodeIntegrationInWorker: false,
            webSecurity: true,
            allowRunningInsecureContent: false,
            webviewTag: false,
            spellcheck: false,
        });
    });
});

describe('CONTENT_SECURITY_POLICY', () => {
    it('allows only the app scheme and opens no network connections (SEC-01)', () => {
        expect(CONTENT_SECURITY_POLICY).toBe(
            "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
                "font-src 'self'; connect-src 'none'",
        );
    });
});
