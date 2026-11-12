import { describe, expect, it } from 'vitest';
import { contentTypeFor, resolveAppRequest } from './app-protocol';

const ROOT = '/bundle/out/renderer';

describe('resolveAppRequest', () => {
    it('maps app://trc paths into the renderer root', () => {
        expect(resolveAppRequest('app://trc/index.html', ROOT)).toBe('/bundle/out/renderer/index.html');
        expect(resolveAppRequest('app://trc/assets/a%20b.js', ROOT)).toBe('/bundle/out/renderer/assets/a b.js');
    });

    it('serves index.html for the root path', () => {
        expect(resolveAppRequest('app://trc/', ROOT)).toBe('/bundle/out/renderer/index.html');
    });

    it('refuses other hosts, other schemes and paths that escape the root', () => {
        expect(resolveAppRequest('app://other/index.html', ROOT)).toBeUndefined();
        expect(resolveAppRequest('file:///etc/passwd', ROOT)).toBeUndefined();
        expect(resolveAppRequest('app://trc/..%2fsecret', ROOT)).toBeUndefined();
        expect(resolveAppRequest('app://trc/a/..%2f..%2f..%2fsecret', ROOT)).toBeUndefined();
    });

    it('keeps dot segments that URL parsing normalizes inside the root', () => {
        expect(resolveAppRequest('app://trc/%2e%2e/%2e%2e/secret', ROOT)).toBe('/bundle/out/renderer/secret');
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
