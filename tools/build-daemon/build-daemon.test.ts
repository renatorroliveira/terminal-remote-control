import { describe, expect, it } from 'vitest';
import { DAEMON_TARGETS, manifestFor } from './build-daemon.ts';

describe('build-daemon', () => {
    it('builds both Linux musl targets', () => {
        expect(DAEMON_TARGETS).toEqual([
            { platform: 'linux-x64', triple: 'x86_64-unknown-linux-musl' },
            { platform: 'linux-arm64', triple: 'aarch64-unknown-linux-musl' },
        ]);
    });

    it('writes the manifest the app reads', () => {
        const sha = 'a'.repeat(64);
        const text = manifestFor('0.1.0', [
            { platform: 'linux-x64', sha256: sha, size: 3 },
            { platform: 'linux-arm64', sha256: sha, size: 4 },
        ]);
        expect(JSON.parse(text)).toEqual({
            version: '0.1.0',
            binaries: { 'linux-x64': { sha256: sha, size: 3 }, 'linux-arm64': { sha256: sha, size: 4 } },
        });
        expect(text.endsWith('\n')).toBe(true);
    });
});
