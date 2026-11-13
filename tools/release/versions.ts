/** Which part of a semver release a new release increments. */
export type Bump = 'major' | 'minor' | 'patch';

const RELEASE = /^(\d+)\.(\d+)\.(\d+)$/;
const RELEASE_TAG = /^v(\d+\.\d+\.\d+)$/;
const PACKAGE_VERSION = /^(\s*"version":\s*")[^"]+(")/m;
const WORKSPACE_PACKAGE = /^\[workspace\.package\]\n(?:(?!\[)[^\n]*\n)*?version = "[^"]+"/m;

/** The release after `version`: its major, minor or patch number up by one, and the parts after it reset. */
export function bumpVersion(version: string, bump: Bump): string {
    const parts = RELEASE.exec(version);
    if (parts === null) {
        throw new Error(`not a release version: ${JSON.stringify(version)}`);
    }
    const [major, minor, patch] = parts.slice(1).map(Number) as [number, number, number];
    switch (bump) {
        case 'major':
            return `${major + 1}.0.0`;
        case 'minor':
            return `${major}.${minor + 1}.0`;
        case 'patch':
            return `${major}.${minor}.${patch + 1}`;
    }
}

/** The version `main` carries after `release` ships: the next minor, marked as a development build. */
export function devVersion(release: string): string {
    return `${bumpVersion(release, 'minor')}-dev`;
}

/** The highest release among git tags such as `v0.1.0`, or `0.0.0` before the first release. */
export function lastRelease(tags: readonly string[]): string {
    const releases = tags.flatMap((tag) => RELEASE_TAG.exec(tag)?.[1] ?? []);
    return releases.reduce((highest, candidate) => (compare(candidate, highest) > 0 ? candidate : highest), '0.0.0');
}

/** A package.json text with its `version` set, formatting kept. */
export function setPackageVersion(json: string, version: string): string {
    if (!PACKAGE_VERSION.test(json)) {
        throw new Error('package.json has no version');
    }
    return json.replace(PACKAGE_VERSION, `$1${version}$2`);
}

/** A Cargo.toml text with its `[workspace.package]` version set, formatting kept. */
export function setCargoVersion(toml: string, version: string): string {
    const section = WORKSPACE_PACKAGE.exec(toml)?.[0];
    if (section === undefined) {
        throw new Error('Cargo.toml has no [workspace.package] version');
    }
    return toml.replace(section, section.replace(/version = "[^"]+"$/, `version = "${version}"`));
}

/** A Cargo.lock text with the version of each named workspace crate set, so `cargo --locked` accepts it. */
export function setCargoLockVersion(lock: string, crates: readonly string[], version: string): string {
    return crates.reduce((text, crate) => {
        const entry = new RegExp(`(\\[\\[package\\]\\]\\nname = "${crate}"\\nversion = ")[^"]+(")`);
        if (!entry.test(text)) {
            throw new Error(`Cargo.lock has no package ${crate}`);
        }
        return text.replace(entry, `$1${version}$2`);
    }, lock);
}

/** The package name in a crate's Cargo.toml. */
export function crateName(toml: string): string {
    const name = /^\[package\]\n(?:(?!\[)[^\n]*\n)*?name = "([^"]+)"/m.exec(toml)?.[1];
    if (name === undefined) {
        throw new Error('Cargo.toml has no package name');
    }
    return name;
}

function compare(left: string, right: string): number {
    const a = left.split('.').map(Number);
    const b = right.split('.').map(Number);
    return (a[0] ?? 0) - (b[0] ?? 0) || (a[1] ?? 0) - (b[1] ?? 0) || (a[2] ?? 0) - (b[2] ?? 0);
}
