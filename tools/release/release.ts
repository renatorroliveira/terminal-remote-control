import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArguments, type ReleaseOptions } from './arguments.ts';
import { releaseNotes } from './notes.ts';
import { bumpVersion, devVersion, lastRelease, setCargoVersion, setPackageVersion } from './versions.ts';

/** The repository root. */
const ROOT = resolve(import.meta.dirname, '../..');
/** Every manifest whose version moves with a release. */
const PACKAGE_MANIFESTS = ['package.json', 'apps/desktop/package.json', 'packages/protocol/package.json'] as const;
const DIST = join(ROOT, 'apps/desktop/dist');
const REPOSITORY_FILES = [...PACKAGE_MANIFESTS, 'Cargo.toml', 'Cargo.lock'] as const;

/**
 * Cuts a release on GitHub (semver from the last `v*` tag): checks the tree, runs `pnpm check`, sets the version in
 * every manifest, builds the daemons and the ad-hoc signed macOS dmg and zip for arm64 and x64, commits, tags,
 * pushes, publishes the GitHub release with notes and SHA-256 sums, then moves `main` to the next `-dev` version.
 */
export function release(options: ReleaseOptions): void {
    const last = lastRelease(capture('git', ['tag', '--list', 'v*']).split('\n'));
    const version = bumpVersion(last, options.bump);
    const range = last === '0.0.0' ? ['HEAD'] : [`v${last}..HEAD`];
    const notes = releaseNotes(version, capture('git', ['log', ...range, '--format=%s']).split('\n'));
    process.stdout.write(`release ${version} (last ${last}), then ${devVersion(version)}\n\n${notes}\n`);
    if (options.dryRun) {
        return;
    }
    preflight();
    run('pnpm', ['check']);
    setVersion(version);
    run('pnpm', ['build:daemon']);
    rmSync(DIST, { recursive: true, force: true });
    run('pnpm', ['dist']);
    const assets = releaseAssets(version);
    commit(`chore(release): v${version}`, `Release Terminal Remote Control ${version}.`);
    run('git', ['tag', '-a', `v${version}`, '-m', `Terminal Remote Control ${version}`]);
    run('git', ['push', 'origin', 'main', `v${version}`]);
    publish(version, notes, assets);
    setVersion(devVersion(version));
    commit(
        `chore(release): start ${devVersion(version)}`,
        `Development continues toward the release after ${version}.`,
    );
    run('git', ['push', 'origin', 'main']);
}

function preflight(): void {
    const branch = capture('git', ['branch', '--show-current']);
    if (branch !== 'main') {
        throw new Error(`release from main, not ${branch}`);
    }
    if (capture('git', ['status', '--porcelain']) !== '') {
        throw new Error('the working tree has uncommitted changes');
    }
    run('git', ['fetch', 'origin', 'main', '--tags']);
    if (capture('git', ['rev-parse', 'HEAD']) !== capture('git', ['rev-parse', 'origin/main'])) {
        throw new Error('main and origin/main differ; pull or push first');
    }
    run('gh', ['auth', 'status']);
}

function setVersion(version: string): void {
    for (const manifest of PACKAGE_MANIFESTS) {
        const path = join(ROOT, manifest);
        writeFileSync(path, setPackageVersion(readFileSync(path, 'utf8'), version));
    }
    const cargo = join(ROOT, 'Cargo.toml');
    writeFileSync(cargo, setCargoVersion(readFileSync(cargo, 'utf8'), version));
    run('cargo', ['update', '--workspace', '--offline']);
}

function releaseAssets(version: string): readonly string[] {
    const prefix = `TRC-${version}-mac-`;
    const files = readdirSync(DIST).filter((file) => file.startsWith(prefix) && /\.(dmg|zip)$/.test(file));
    if (files.length === 0) {
        throw new Error(`no ${prefix}* packages in ${DIST}`);
    }
    const sums = files.map(
        (file) =>
            `${createHash('sha256')
                .update(readFileSync(join(DIST, file)))
                .digest('hex')}  ${file}`,
    );
    const sumsFile = join(DIST, 'SHA256SUMS.txt');
    writeFileSync(sumsFile, `${sums.join('\n')}\n`);
    return [...files.map((file) => join(DIST, file)), sumsFile];
}

function publish(version: string, notes: string, assets: readonly string[]): void {
    const notesFile = join(mkdtempSync(join(tmpdir(), 'trc-release-')), 'notes.md');
    writeFileSync(notesFile, notes);
    const title = `Terminal Remote Control ${version}`;
    run('gh', [
        'release',
        'create',
        `v${version}`,
        '--verify-tag',
        '--title',
        title,
        '--notes-file',
        notesFile,
        ...assets,
    ]);
}

function commit(subject: string, body: string): void {
    run('git', ['add', ...REPOSITORY_FILES]);
    run('git', ['commit', '--allow-empty', '-m', subject, '-m', body]);
}

function run(command: string, args: readonly string[]): void {
    execFileSync(command, args, { cwd: ROOT, stdio: 'inherit' });
}

function capture(command: string, args: readonly string[]): string {
    return execFileSync(command, args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

if (import.meta.main) {
    release(parseArguments(process.argv.slice(2)));
}
