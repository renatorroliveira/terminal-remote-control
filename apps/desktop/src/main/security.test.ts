import { describe, expect, it } from 'vitest';
import {
    CONTENT_SECURITY_POLICY,
    documentWebPreferences,
    GUIDE_CONTENT_SECURITY_POLICY,
    secureWebPreferences,
} from './security';

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

    it('gives a document window such as the user guide the same sandbox and no preload, so no bridge (P-18)', () => {
        const { preload: _preload, ...sandboxed } = secureWebPreferences('');
        expect(documentWebPreferences()).toEqual(sandboxed);
    });
});

describe('CONTENT_SECURITY_POLICY', () => {
    it('allows only the app scheme and opens no network connections (SEC-01)', () => {
        expect(CONTENT_SECURITY_POLICY).toBe(
            "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
                "font-src 'self'; connect-src 'none'",
        );
    });

    it('lets the user guide load only its own styles, with no scripts at all (P-18)', () => {
        expect(GUIDE_CONTENT_SECURITY_POLICY).toBe("default-src 'none'; style-src 'self'; img-src 'self'");
    });
});
