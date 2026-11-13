import { describe, expect, it } from 'vitest';
import {
    bumpVersion,
    checkReleaseVersion,
    crateName,
    devVersion,
    lastRelease,
    setCargoLockVersion,
    setCargoVersion,
    setPackageVersion,
} from './versions.ts';

describe('release versions (semver)', () => {
    it('bumps the last release by major, minor or patch', () => {
        expect(bumpVersion('0.0.0', 'minor')).toBe('0.1.0');
        expect(bumpVersion('0.1.0', 'patch')).toBe('0.1.1');
        expect(bumpVersion('0.1.4', 'minor')).toBe('0.2.0');
        expect(bumpVersion('1.4.2', 'major')).toBe('2.0.0');
        expect(() => bumpVersion('1.2', 'patch')).toThrow(/not a release version/);
    });

    it('names the development version after a release: the next minor, marked dev', () => {
        expect(devVersion('0.1.0')).toBe('0.2.0-dev');
        expect(devVersion('1.9.3')).toBe('1.10.0-dev');
    });

    it('refuses a release numbered below the version main carries, and accepts one at or above it', () => {
        expect(() => checkReleaseVersion('0.1.1', '0.2.0-dev')).toThrow(/0\.1\.1 is below 0\.2\.0-dev/);
        expect(() => checkReleaseVersion('0.2.0', '0.2.0-dev')).not.toThrow();
        expect(() => checkReleaseVersion('1.0.0', '0.2.0-dev')).not.toThrow();
        expect(() => checkReleaseVersion('0.10.0', '0.9.0-dev')).not.toThrow();
    });

    it('takes the highest v-tag as the last release, and 0.0.0 before the first', () => {
        expect(lastRelease([])).toBe('0.0.0');
        expect(lastRelease(['v0.1.0', 'v0.10.0', 'v0.9.1', 'nightly', 'v1.0.0-rc.1'])).toBe('0.10.0');
    });

    it('rewrites the version of a package.json and of the Cargo workspace, and nothing else', () => {
        const json = '{\n    "name": "@trc/desktop",\n    "version": "0.1.0",\n    "private": true\n}\n';
        expect(setPackageVersion(json, '0.2.0-dev')).toBe(json.replace('"0.1.0"', '"0.2.0-dev"'));
        const toml =
            '[workspace]\nmembers = []\n\n[workspace.package]\nversion = "0.1.0"\nedition = "2024"\n\n[dependencies]\nfoo = { version = "1.0" }\n';
        expect(setCargoVersion(toml, '0.2.0-dev')).toBe(toml.replace('version = "0.1.0"', 'version = "0.2.0-dev"'));
        expect(() => setCargoVersion('[package]\nname = "x"\n', '1.0.0')).toThrow(/workspace.package/);
    });
});

describe('Cargo.lock versions', () => {
    const lock =
        '[[package]]\nname = "serde"\nversion = "1.0.0"\n\n[[package]]\nname = "trcd"\nversion = "0.2.0-dev"\ndependencies = [\n "serde",\n]\n\n[[package]]\nname = "trc-vt"\nversion = "0.2.0-dev"\n';

    it('sets the version of the workspace crates only, so `cargo --locked` accepts the release commit', () => {
        expect(setCargoLockVersion(lock, ['trcd', 'trc-vt'], '0.2.0')).toBe(lock.replaceAll('"0.2.0-dev"', '"0.2.0"'));
    });

    it('fails for a crate the lock file does not list', () => {
        expect(() => setCargoLockVersion(lock, ['trc-protocol'], '0.2.0')).toThrow(/trc-protocol/);
    });

    it('reads a crate name from its Cargo.toml', () => {
        expect(crateName('[package]\nname = "trc-vt"\nversion.workspace = true\n')).toBe('trc-vt');
        expect(() => crateName('[workspace]\n')).toThrow(/no package name/);
    });
});
