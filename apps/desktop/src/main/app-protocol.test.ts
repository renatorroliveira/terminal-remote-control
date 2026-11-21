import { join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentTypeFor, resolveAppRequest } from './app-protocol';

/** Absolute on this OS, as the real roots are: `/bundle/...` on macOS, `<drive>:\bundle\...` on Windows. */
const ROOT = resolve('/bundle/out/renderer');
const DOCS = resolve('/bundle/resources/docs');
const ROOTS = { trc: ROOT, docs: DOCS };

describe('resolveAppRequest', () => {
    it('maps app://trc paths into the renderer root', () => {
        expect(resolveAppRequest('app://trc/index.html', ROOTS)).toBe(join(ROOT, 'index.html'));
        expect(resolveAppRequest('app://trc/assets/a%20b.js', ROOTS)).toBe(join(ROOT, 'assets', 'a b.js'));
    });

    it('serves index.html for the root path', () => {
        expect(resolveAppRequest('app://trc/', ROOTS)).toBe(join(ROOT, 'index.html'));
    });

    it('refuses other hosts, other schemes and paths that escape the root', () => {
        expect(resolveAppRequest('app://other/index.html', ROOTS)).toBeUndefined();
        expect(resolveAppRequest('file:///etc/passwd', ROOTS)).toBeUndefined();
        expect(resolveAppRequest('app://trc/..%2fsecret', ROOTS)).toBeUndefined();
        expect(resolveAppRequest('app://trc/a/..%2f..%2f..%2fsecret', ROOTS)).toBeUndefined();
    });

    it('never leaves the root through a backslash, a path separator on Windows', () => {
        const file = resolveAppRequest('app://trc/..%5c..%5csecret', ROOTS);
        expect(file === undefined || file.startsWith(ROOT + sep)).toBe(true);
    });

    it('refuses hosts named like object built-ins instead of throwing', () => {
        for (const host of ['constructor', '__proto__', 'tostring', 'hasownproperty']) {
            expect(resolveAppRequest(`app://${host}/x`, ROOTS)).toBeUndefined();
        }
    });

    it('serves the user guide from its own host, kept inside its folder (P-18)', () => {
        expect(resolveAppRequest('app://docs/index.html', ROOTS)).toBe(join(DOCS, 'index.html'));
        expect(resolveAppRequest('app://docs/..%2findex.html', ROOTS)).toBeUndefined();
    });

    it('refuses a path with a malformed escape instead of throwing', () => {
        expect(resolveAppRequest('app://trc/%E0', ROOTS)).toBeUndefined();
        expect(resolveAppRequest('app://docs/a%zz', ROOTS)).toBeUndefined();
    });

    it('keeps dot segments that URL parsing normalizes inside the root', () => {
        expect(resolveAppRequest('app://trc/%2e%2e/%2e%2e/secret', ROOTS)).toBe(join(ROOT, 'secret'));
    });
});

describe('contentTypeFor', () => {
    it('knows the renderer asset types and falls back to octet-stream', () => {
        expect(contentTypeFor('/x/index.html')).toBe('text/html; charset=utf-8');
        expect(contentTypeFor('/x/a.js')).toBe('text/javascript; charset=utf-8');
        expect(contentTypeFor('/x/a.css')).toBe('text/css; charset=utf-8');
        expect(contentTypeFor('/x/a.woff2')).toBe('font/woff2');
        expect(contentTypeFor('/x/a.bin')).toBe('application/octet-stream');
    });
});
