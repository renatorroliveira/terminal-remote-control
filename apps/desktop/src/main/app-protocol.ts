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

/**
 * Maps an `app://trc/...` URL to a file inside the renderer root, or returns `undefined` when the URL has another
 * scheme or host, or would escape the root.
 */
export function resolveAppRequest(url: string, root: string): string | undefined {
    const parsed = URL.canParse(url) ? new URL(url) : undefined;
    if (parsed?.protocol !== `${APP_IDENTITY.appScheme}:` || parsed.host !== APP_IDENTITY.appHost) {
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
