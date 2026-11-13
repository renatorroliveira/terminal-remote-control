/**
 * The release workflow's first step (P-21, D-42): from `main`, it takes the next version from the last `v*` tag,
 * writes the release notes, commits the version, and keeps that commit in a git bundle for the jobs that build,
 * check and publish it. Run `node tools/release/prepare.ts <major|minor|patch> <output folder>` in GitHub Actions.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { releaseNotes } from './notes.ts';
import { capture, commitVersion, ROOT, run, setVersion } from './repository.ts';
import { type Bump, bumpVersion, checkReleaseVersion, lastRelease } from './versions.ts';

const BUMPS: readonly string[] = ['major', 'minor', 'patch'];

/** Prepares the release commit and returns its version. */
export function prepare(bump: Bump, output: string): string {
    const last = lastRelease(capture('git', ['tag', '--list', 'v*']).split('\n'));
    const version = bumpVersion(last, bump);
    checkReleaseVersion(
        version,
        (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }).version,
    );
    const range = last === '0.0.0' ? ['HEAD'] : [`v${last}..HEAD`];
    const notes = releaseNotes(version, capture('git', ['log', ...range, '--format=%s']).split('\n'));
    setVersion(version);
    commitVersion(`chore(release): v${version}`, `Release Terminal Remote Control ${version}.`);
    mkdirSync(output, { recursive: true });
    writeFileSync(join(output, 'notes.md'), notes);
    writeFileSync(join(output, 'version'), version);
    run('git', ['bundle', 'create', join(output, 'release.bundle'), 'HEAD~1..HEAD']);
    return version;
}

if (import.meta.main) {
    const [bump, output] = process.argv.slice(2);
    if (bump === undefined || !BUMPS.includes(bump) || output === undefined) {
        throw new Error('usage: node tools/release/prepare.ts <major|minor|patch> <output folder>');
    }
    const version = prepare(bump as Bump, output);
    process.stdout.write(`release ${version}\n`);
    const outputs = process.env['GITHUB_OUTPUT'];
    if (outputs !== undefined) {
        appendFileSync(outputs, `version=${version}\n`);
    }
}
