/** The Content-Security-Policy every renderer page is served with (TECH_STACK §4.2, SEC-01). */
export const CONTENT_SECURITY_POLICY =
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    "font-src 'self'; connect-src 'none'";

/** The Content-Security-Policy of the user guide's pages: their own stylesheet and images, and no scripts. */
export const GUIDE_CONTENT_SECURITY_POLICY = "default-src 'none'; style-src 'self'; img-src 'self'";

/** Web preferences for a sandboxed, context-isolated renderer. */
export interface SecureWebPreferences {
    readonly preload: string;
    readonly sandbox: true;
    readonly contextIsolation: true;
    readonly nodeIntegration: false;
    readonly nodeIntegrationInWorker: false;
    readonly webSecurity: true;
    readonly allowRunningInsecureContent: false;
    readonly webviewTag: false;
    readonly spellcheck: false;
}

/** Returns the web preferences every app window uses, with the given preload script. */
export function secureWebPreferences(preload: string): SecureWebPreferences {
    return { preload, ...documentWebPreferences() };
}

/** Returns the web preferences of a window that shows a document and gets no preload, such as the user guide. */
export function documentWebPreferences(): Omit<SecureWebPreferences, 'preload'> {
    return {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        spellcheck: false,
    };
}
