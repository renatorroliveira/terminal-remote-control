import { describe, expect, it } from 'vitest';
import { releaseAssets, sha256Sums } from './assets.ts';

describe('release assets', () => {
    const files = [
        'TRC-0.2.0-mac-arm64.dmg',
        'TRC-0.2.0-mac-arm64.dmg.blockmap',
        'TRC-0.2.0-mac-arm64.zip',
        'TRC-0.2.0-mac-x64.dmg',
        'TRC-0.2.0-mac-x64.zip',
        'TRC-0.1.0-mac-x64.zip',
        'TRC-0.2.0-win-arm64-setup.exe',
        'TRC-0.2.0-win-arm64-setup.exe.blockmap',
        'TRC-0.2.0-win-arm64.zip',
        'TRC-0.2.0-win-x64-setup.exe',
        'TRC-0.2.0-win-x64.zip',
        'builder-debug.yml',
    ];

    it('picks the macOS dmg and zip and the Windows installer and zip of both architectures, in order (P-87)', () => {
        expect(releaseAssets(files, '0.2.0')).toEqual([
            'TRC-0.2.0-mac-arm64.dmg',
            'TRC-0.2.0-mac-arm64.zip',
            'TRC-0.2.0-mac-x64.dmg',
            'TRC-0.2.0-mac-x64.zip',
            'TRC-0.2.0-win-arm64-setup.exe',
            'TRC-0.2.0-win-arm64.zip',
            'TRC-0.2.0-win-x64-setup.exe',
            'TRC-0.2.0-win-x64.zip',
        ]);
    });

    it('fails when a package is missing, so a release never ships without one', () => {
        const withoutDmg = files.filter((file) => !file.includes('x64.dmg'));
        expect(() => releaseAssets(withoutDmg, '0.2.0')).toThrow(/TRC-0.2.0-mac-x64.dmg/);
        const withoutInstaller = files.filter((file) => file !== 'TRC-0.2.0-win-arm64-setup.exe');
        expect(() => releaseAssets(withoutInstaller, '0.2.0')).toThrow(/TRC-0.2.0-win-arm64-setup.exe/);
    });

    it('lists the SHA-256 sums the way shasum -c reads them', () => {
        expect(
            sha256Sums([
                { name: 'a.zip', sha256: 'ab12' },
                { name: 'b.dmg', sha256: 'cd34' },
            ]),
        ).toBe('ab12  a.zip\ncd34  b.dmg\n');
    });
});
