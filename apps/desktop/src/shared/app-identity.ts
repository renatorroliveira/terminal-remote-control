/** The product's working identity (P-12). Changing the name for OQ-5 is a change to this object only. */
export const APP_IDENTITY = {
    productName: 'Terminal Remote Control',
    acronym: 'TRC',
    bundleId: 'dev.trc.desktop',
    appScheme: 'app',
    appHost: 'trc',
    /** The `app://` host that serves the user guide, apart from the app's page (P-18). */
    docsHost: 'docs',
    copyright: 'Copyright © 2026 Renato Oliveira',
    repositoryUrl: 'https://github.com/renatorroliveira/terminal-remote-control',
} as const;
