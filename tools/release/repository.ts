/** The repository operations a release runs: versions in every manifest, commits, and commands. */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { crateName, setCargoLockVersion, setCargoVersion, setPackageVersion } from './versions.ts';

/** The repository root. */
export const ROOT = resolve(import.meta.dirname, '../..');

/** Every manifest whose version moves with a release. */
const PACKAGE_MANIFESTS = ['package.json', 'apps/desktop/package.json', 'packages/protocol/package.json'] as const;
/** Every file a release's version commits change. */
export const VERSION_FILES = [...PACKAGE_MANIFESTS, 'Cargo.toml', 'Cargo.lock'] as const;

/** Sets `version` in every package manifest, the Cargo workspace and Cargo.lock. */
export function setVersion(version: string): void {
    for (const manifest of PACKAGE_MANIFESTS) {
        edit(manifest, (text) => setPackageVersion(text, version));
    }
    edit('Cargo.toml', (text) => setCargoVersion(text, version));
    edit('Cargo.lock', (text) => setCargoLockVersion(text, workspaceCrates(), version));
}

/** Commits the version files through the repository's hooks. */
export function commitVersion(subject: string, body: string): void {
    run('git', ['add', ...VERSION_FILES]);
    run('git', ['commit', '-m', subject, '-m', body]);
}

/** Runs a command in the repository, its output shown. */
export function run(command: string, args: readonly string[]): void {
    execFileSync(command, args, { cwd: ROOT, stdio: 'inherit' });
}

/** Runs a command in the repository and returns its trimmed output. */
export function capture(command: string, args: readonly string[]): string {
    return execFileSync(command, args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function workspaceCrates(): readonly string[] {
    return readdirSync(join(ROOT, 'crates'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => crateName(readFileSync(join(ROOT, 'crates', entry.name, 'Cargo.toml'), 'utf8')));
}

function edit(file: string, change: (text: string) => string): void {
    const path = join(ROOT, file);
    writeFileSync(path, change(readFileSync(path, 'utf8')));
}
