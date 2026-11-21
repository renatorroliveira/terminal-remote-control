import { describe, expect, it } from 'vitest';
import { buildCommands, buildsFor, builtBinary, DAEMON_BUILDS, manifestFor } from './build-daemon.ts';

describe('build-daemon', () => {
    it('builds both Linux musl targets and one universal macOS binary', () => {
        expect(DAEMON_BUILDS).toEqual([
            { platform: 'linux-x64', triples: ['x86_64-unknown-linux-musl'] },
            { platform: 'linux-arm64', triples: ['aarch64-unknown-linux-musl'] },
            { platform: 'darwin-universal', triples: ['aarch64-apple-darwin', 'x86_64-apple-darwin'] },
        ]);
    });

    it('builds every daemon on macOS and all but the macOS one elsewhere', () => {
        expect(buildsFor('darwin')).toEqual(DAEMON_BUILDS);
        expect(buildsFor('win32').map((build) => build.platform)).toEqual(['linux-x64', 'linux-arm64']);
        expect(buildsFor('linux').map((build) => build.platform)).toEqual(['linux-x64', 'linux-arm64']);
    });

    it('cross-builds a Linux daemon with cargo-zigbuild and copies it', () => {
        const [linux] = DAEMON_BUILDS;
        expect(linux && buildCommands(linux, '/out/linux-x64/trcd')).toEqual([
            [
                'cargo',
                'zigbuild',
                '--locked',
                '--quiet',
                '--release',
                '--target',
                'x86_64-unknown-linux-musl',
                '-p',
                'trcd',
            ],
        ]);
        expect(linux && builtBinary(linux)).toBe('target/x86_64-unknown-linux-musl/release/trcd');
    });

    it('joins both Apple slices with lipo and signs the result ad hoc (US-4.5.1)', () => {
        const mac = DAEMON_BUILDS.find((build) => build.platform === 'darwin-universal');
        expect(mac && buildCommands(mac, '/out/darwin-universal/trcd')).toEqual([
            ['cargo', 'build', '--locked', '--quiet', '--release', '--target', 'aarch64-apple-darwin', '-p', 'trcd'],
            ['cargo', 'build', '--locked', '--quiet', '--release', '--target', 'x86_64-apple-darwin', '-p', 'trcd'],
            [
                'lipo',
                '-create',
                '-output',
                '/out/darwin-universal/trcd',
                'target/aarch64-apple-darwin/release/trcd',
                'target/x86_64-apple-darwin/release/trcd',
            ],
            ['codesign', '--force', '--sign', '-', '/out/darwin-universal/trcd'],
        ]);
        expect(mac && builtBinary(mac)).toBeUndefined();
    });

    it('writes the manifest the app reads', () => {
        const sha = 'a'.repeat(64);
        const text = manifestFor('0.1.0', [
            { platform: 'linux-x64', sha256: sha, size: 3 },
            { platform: 'linux-arm64', sha256: sha, size: 4 },
            { platform: 'darwin-universal', sha256: sha, size: 5 },
        ]);
        expect(JSON.parse(text)).toEqual({
            version: '0.1.0',
            binaries: {
                'linux-x64': { sha256: sha, size: 3 },
                'linux-arm64': { sha256: sha, size: 4 },
                'darwin-universal': { sha256: sha, size: 5 },
            },
        });
        expect(text.endsWith('\n')).toBe(true);
    });
});
