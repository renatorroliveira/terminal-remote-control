import { APP_IDENTITY } from '../shared/app-identity';

const APP_ORIGIN = `${APP_IDENTITY.appScheme}://${APP_IDENTITY.appHost}`;

/**
 * Whether `url` is the app's own page: the `app://` origin, or the dev server's origin in development. A custom
 * scheme's `URL.origin` is opaque, so the scheme and host are compared.
 */
export function isAppPage(url: string | undefined, devServer: string | undefined): boolean {
    if (url === undefined || !URL.canParse(url)) {
        return false;
    }
    const origin = originOf(url);
    return (
        origin === APP_ORIGIN || (devServer !== undefined && URL.canParse(devServer) && origin === originOf(devServer))
    );
}

function originOf(url: string): string {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
}
