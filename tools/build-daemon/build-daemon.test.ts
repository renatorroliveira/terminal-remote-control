import { describe, expect, it } from 'vitest';
import { binaryName, buildCommands, buildsFor, builtBinary, DAEMON_BUILDS, manifestFor } from './build-daemon.ts';

describe('build-daemon platforms', () => {
    it('builds both Linux musl targets, one universal macOS binary and Windows x64 and arm64', () => {
        expect(DAEMON_BUILDS).toEqual([
            { platform: 'linux-x64', triples: ['x86_64-unknown-linux-musl'] },
            { platform: 'linux-arm64', triples: ['aarch64-unknown-linux-musl'] },
            { platform: 'darwin-universal', triples: ['aarch64-apple-darwin', 'x86_64-apple-darwin'] },
            { platform: 'windows-x64', triples: ['x86_64-pc-windows-msvc'] },
            { platform: 'windows-arm64', triples: ['aarch64-pc-windows-msvc'] },
        ]);
    });

    it('builds the Linux daemons everywhere, the macOS one on macOS and the Windows one of its own architecture', () => {
        const platforms = (host: NodeJS.Platform, arch: string): readonly string[] =>
            buildsFor(host, arch).map((build) => build.platform);
        expect(platforms('darwin', 'arm64')).toEqual(['linux-x64', 'linux-arm64', 'darwin-universal']);
        expect(platforms('win32', 'x64')).toEqual(['linux-x64', 'linux-arm64', 'windows-x64']);
        expect(platforms('win32', 'arm64')).toEqual(['linux-x64', 'linux-arm64', 'windows-arm64']);
        expect(platforms('linux', 'x64')).toEqual(['linux-x64', 'linux-arm64']);
    });

    it('builds trcd.exe for Windows with cargo and MSVC (D-66)', () => {
        const windows = DAEMON_BUILDS.find((build) => build.platform === 'windows-arm64');
        expect(windows && buildCommands(windows, 'C:/out/windows-arm64/trcd.exe')).toEqual([
            ['cargo', 'build', '--locked', '--quiet', '--release', '--target', 'aarch64-pc-windows-msvc', '-p', 'trcd'],
        ]);
        expect(windows && builtBinary(windows)).toBe('target/aarch64-pc-windows-msvc/release/trcd.exe');
        expect(windows && binaryName(windows)).toBe('trcd.exe');
    });
});

describe('build-daemon commands and manifest', () => {
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
