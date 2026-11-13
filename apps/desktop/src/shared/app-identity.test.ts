import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_IDENTITY } from './app-identity';

const PACKAGE_ROOT = join(import.meta.dirname, '..', '..');

describe('APP_IDENTITY', () => {
    it('holds the working product identity in one place (P-12, OQ-5)', () => {
        expect(APP_IDENTITY).toEqual({
            productName: 'Terminal Remote Control',
            acronym: 'TRC',
            bundleId: 'dev.trc.desktop',
            appScheme: 'app',
            appHost: 'trc',
            docsHost: 'docs',
            copyright: 'Copyright © 2026 Renato Oliveira',
            repositoryUrl: 'https://github.com/renatorroliveira/terminal-remote-control',
        });
    });

    it('names the app package and the packaged bundle after it, so Electron names the profile folder the same', () => {
        const manifest: { readonly productName?: unknown } = JSON.parse(
            readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'),
        );
        const builder = readFileSync(join(PACKAGE_ROOT, 'electron-builder.yml'), 'utf8');
        expect(manifest.productName).toBe(APP_IDENTITY.productName);
        expect(builder).toContain(`productName: ${APP_IDENTITY.productName}\n`);
        expect(builder).toContain(`appId: ${APP_IDENTITY.bundleId}\n`);
        expect(builder).toContain(`copyright: ${APP_IDENTITY.copyright}\n`);
    });
});
