import { extname, resolve, sep } from 'node:path';
import { APP_IDENTITY } from '../shared/app-identity';

const CONTENT_TYPES: Readonly<Record<string, string>> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
};

/** The folder each `app://` host serves: the renderer for the app's page, and the user guide's. */
export type AppRoots = Readonly<Record<string, string>>;

/**
 * Maps an `app://<host>/...` URL to a file inside that host's root, or returns `undefined` when the URL has another
 * scheme or an unknown host, or would escape the root.
 */
export function resolveAppRequest(url: string, roots: AppRoots): string | undefined {
    const parsed = URL.canParse(url) ? new URL(url) : undefined;
    const root = parsed !== undefined && Object.hasOwn(roots, parsed.host) ? roots[parsed.host] : undefined;
    if (parsed?.protocol !== `${APP_IDENTITY.appScheme}:` || root === undefined) {
        return undefined;
    }
    const relative = decodeURIComponent(parsed.pathname).replace(/^\/+/, '') || 'index.html';
    const file = resolve(root, relative);
    return file.startsWith(root + sep) ? file : undefined;
}

/** Returns the Content-Type header for a renderer asset path. */
export function contentTypeFor(path: string): string {
    return CONTENT_TYPES[extname(path)] ?? 'application/octet-stream';
}
