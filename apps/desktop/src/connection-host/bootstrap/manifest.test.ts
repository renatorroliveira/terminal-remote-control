import { describe, expect, it } from 'vitest';
import { parseDaemonManifest } from './manifest';

const sha = 'd'.repeat(64);

describe('parseDaemonManifest', () => {
    it('accepts a manifest with both Linux binaries', () => {
        const text = JSON.stringify({
            version: '0.1.0',
            binaries: { 'linux-x64': { sha256: sha, size: 10 }, 'linux-arm64': { sha256: sha, size: 12 } },
        });
        expect(parseDaemonManifest(text)).toEqual({
            version: '0.1.0',
            binaries: { 'linux-x64': { sha256: sha, size: 10 }, 'linux-arm64': { sha256: sha, size: 12 } },
        });
    });

    it.each([
        ['a bad checksum', { version: '0.1.0', binaries: { 'linux-x64': { sha256: 'xyz', size: 1 } } }],
        ['a negative size', { version: '0.1.0', binaries: { 'linux-x64': { sha256: sha, size: -1 } } }],
        ['an unknown platform', { version: '0.1.0', binaries: { 'linux-mips': { sha256: sha, size: 1 } } }],
        ['no version', { binaries: {} }],
    ])('refuses %s', (_label, value) => {
        expect(() => parseDaemonManifest(JSON.stringify(value))).toThrow();
    });
});
