/**
 * The release workflow's last step (P-21, D-42), run once every build and check has passed: it tags the release
 * commit, pushes `main` and the tag together (refused when `main` moved meanwhile), publishes the GitHub Release
 * `TRC v<version>` with its notes, the four packages and `SHA256SUMS.txt`, checks that anyone can download it, then
 * moves `main` to the next `-dev` version. Run `node tools/release/publish.ts <version> <notes> <packages folder>`.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { releaseAssets, sha256Sums } from './assets.ts';
import { releaseTitle } from './notes.ts';
import { commitVersion, run, setVersion } from './repository.ts';
import { devVersion } from './versions.ts';

const PUBLIC_ATTEMPTS = 6;

/** Publishes `version` from the checked-out release commit. */
export async function publish(version: string, notes: string, packages: string): Promise<void> {
    const assets = releaseAssets(readdirSync(packages), version).map((name) => join(packages, name));
    const sums = sha256Sums(
        assets.map((path) => ({
            name: path.slice(packages.length + 1),
            sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
        })),
    );
    const sumsFile = join(packages, 'SHA256SUMS.txt');
    writeFileSync(sumsFile, sums);
    const tag = `v${version}`;
    run('git', ['tag', '-a', tag, '-m', releaseTitle(version)]);
    run('git', ['push', '--atomic', 'origin', 'HEAD:refs/heads/main', `refs/tags/${tag}`]);
    run('gh', [
        'release',
        'create',
        tag,
        '--verify-tag',
        '--title',
        releaseTitle(version),
        '--notes-file',
        notes,
        ...assets,
        sumsFile,
    ]);
    await expectPublic(tag, sums);
    setVersion(devVersion(version));
    commitVersion(
        `chore(release): start ${devVersion(version)}`,
        `Development continues toward the release after ${version}.`,
    );
    run('git', ['push', 'origin', 'HEAD:refs/heads/main']);
}

/**
 * Downloads the sums without credentials, a few times while the release propagates: a release is public, so anyone
 * must get exactly what was published.
 */
async function expectPublic(tag: string, sums: string): Promise<void> {
    const repository = process.env['GITHUB_REPOSITORY'];
    if (repository === undefined) {
        throw new Error('GITHUB_REPOSITORY is not set');
    }
    const url = `https://github.com/${repository}/releases/download/${tag}/SHA256SUMS.txt`;
    let status = 0;
    for (let attempt = 0; attempt < PUBLIC_ATTEMPTS; attempt += 1) {
        const response = await fetch(url);
        status = response.status;
        if (response.ok && (await response.text()) === sums) {
            return;
        }
        await delay(5_000);
    }
    throw new Error(`anyone should download ${url} as published, but got HTTP ${status}`);
}

if (import.meta.main) {
    const [version, notes, packages] = process.argv.slice(2);
    if (version === undefined || notes === undefined || packages === undefined) {
        throw new Error('usage: node tools/release/publish.ts <version> <notes file> <packages folder>');
    }
    await publish(version, notes, packages);
}
