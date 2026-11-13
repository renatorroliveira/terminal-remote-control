import { describe, expect, it } from 'vitest';
import { bumpVersion, devVersion, lastRelease, setCargoVersion, setPackageVersion } from './versions.ts';

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
