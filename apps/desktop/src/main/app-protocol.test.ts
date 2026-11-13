import { describe, expect, it } from 'vitest';
import { contentTypeFor, resolveAppRequest } from './app-protocol';

const ROOT = '/bundle/out/renderer';
const ROOTS = { trc: ROOT, docs: '/bundle/resources/docs' };

describe('resolveAppRequest', () => {
    it('maps app://trc paths into the renderer root', () => {
        expect(resolveAppRequest('app://trc/index.html', ROOTS)).toBe('/bundle/out/renderer/index.html');
        expect(resolveAppRequest('app://trc/assets/a%20b.js', ROOTS)).toBe('/bundle/out/renderer/assets/a b.js');
    });

    it('serves index.html for the root path', () => {
        expect(resolveAppRequest('app://trc/', ROOTS)).toBe('/bundle/out/renderer/index.html');
    });

    it('refuses other hosts, other schemes and paths that escape the root', () => {
        expect(resolveAppRequest('app://other/index.html', ROOTS)).toBeUndefined();
        expect(resolveAppRequest('file:///etc/passwd', ROOTS)).toBeUndefined();
        expect(resolveAppRequest('app://trc/..%2fsecret', ROOTS)).toBeUndefined();
        expect(resolveAppRequest('app://trc/a/..%2f..%2f..%2fsecret', ROOTS)).toBeUndefined();
    });

    it('serves the user guide from its own host, kept inside its folder (P-18)', () => {
        expect(resolveAppRequest('app://docs/index.html', ROOTS)).toBe('/bundle/resources/docs/index.html');
        expect(resolveAppRequest('app://docs/..%2findex.html', ROOTS)).toBeUndefined();
    });

    it('keeps dot segments that URL parsing normalizes inside the root', () => {
        expect(resolveAppRequest('app://trc/%2e%2e/%2e%2e/secret', ROOTS)).toBe('/bundle/out/renderer/secret');
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
