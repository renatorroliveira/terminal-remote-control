/**
 * The release workflow's last step (P-21, D-42), run once every build and check has passed. It checks that the
 * release commit is the prepare job's version commit on the workflow's own commit, tags it, pushes `main` and the
 * tag together (refused when `main` moved meanwhile), publishes the GitHub Release `TRC v<version>` as a draft that
 * goes public only once its notes, four packages and `SHA256SUMS.txt` are all up, moves `main` to the next `-dev`
 * version, and checks that anyone can download the release. Each step skips what an earlier run finished, so a
 * failed run is resumed by re-running the job. Run
 * `node tools/release/publish.ts <version> <notes> <packages folder>` with `GITHUB_SHA` and `GITHUB_REPOSITORY`.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { releaseAssets, sha256Sums } from './assets.ts';
import { releaseTitle } from './notes.ts';
import { capture, commitVersion, run, setVersion, VERSION_FILES } from './repository.ts';
import { devVersion } from './versions.ts';

/** A downloaded file: its HTTP status and its text. */
export interface Download {
    readonly status: number;
    readonly text: string;
}

/** What publishing needs from git, gh and the network; the release workflow passes the real ones. */
export interface PublishSeams {
    /** Runs a command; the release fails when it fails. */
    run(command: string, args: readonly string[]): void;
    /** Runs a command and returns its trimmed output; the release fails when it fails. */
    capture(command: string, args: readonly string[]): string;
    /** Whether the tag's GitHub release in `repository` is absent, a draft or published; fails when it cannot tell. */
    releaseState(repository: string, tag: string): ReleaseState;
    /** Downloads a URL without credentials. */
    download(url: string): Promise<Download>;
    /** Waits before trying again. */
    wait(milliseconds: number): Promise<void>;
    /** Sets the version in every manifest. */
    setVersion(version: string): void;
    /** Commits the version files through the repository's hooks. */
    commitVersion(subject: string, body: string): void;
}

/** Where a tag's GitHub release stands. */
export type ReleaseState = 'absent' | 'draft' | 'published';

/** One release to publish. */
export interface ReleaseInput {
    readonly version: string;
    /** The release notes file. */
    readonly notes: string;
    /** Every file the release carries: the packages and `SHA256SUMS.txt`. */
    readonly assets: readonly string[];
    /** The text of `SHA256SUMS.txt`. */
    readonly sums: string;
    /** The commit the workflow started from, which the release commit must sit on. */
    readonly base: string;
    /** The GitHub repository, `owner/name`. */
    readonly repository: string;
}

const PUBLIC_ATTEMPTS = 6;

/**
 * Reads where `tag`'s release stands from the drafts flag of each release named for it, one per line, as a listing of
 * every release, drafts included, gives it. Anything but no release or exactly one `true` or `false` fails the
 * release: `gh release view` says "release not found" for a draft it failed to look up, which would lead to a second
 * draft.
 */
export function releaseStateOf(listed: string, tag: string): ReleaseState {
    const flags = listed.split('\n').filter((line) => line !== '');
    if (flags.length > 1) {
        throw new Error(`${tag} has ${flags.length} releases; delete the extra drafts, then re-run`);
    }
    const [flag] = flags;
    if (flag === undefined) {
        return 'absent';
    }
    if (flag === 'true' || flag === 'false') {
        return flag === 'true' ? 'draft' : 'published';
    }
    throw new Error(`the release listing gave ${flag} as the draft flag of ${tag}`);
}

/** Publishes the checked-out release commit, resuming whatever an earlier run of the same release left undone. */
export async function publish(input: ReleaseInput, seams: PublishSeams): Promise<void> {
    checkReleaseCommit(input.base, seams);
    pushTag(input.version, seams);
    publishRelease(input, seams);
    startNextVersion(input.version, seams);
    await expectPublic(input, seams);
}

function checkReleaseCommit(base: string, seams: PublishSeams): void {
    const parent = seams.capture('git', ['rev-parse', 'HEAD~1']);
    if (parent !== base) {
        throw new Error(`the release commit must sit on ${base}, the commit the workflow started from, not ${parent}`);
    }
    const changed = seams.capture('git', ['diff', '--name-only', 'HEAD~1', 'HEAD']).split('\n');
    const unexpected = changed.filter((file) => !(VERSION_FILES as readonly string[]).includes(file));
    if (unexpected.length > 0) {
        throw new Error(`the release commit may change only the version files, but changes ${unexpected.join(', ')}`);
    }
}

function pushTag(version: string, seams: PublishSeams): void {
    const tag = `v${version}`;
    const head = seams.capture('git', ['rev-parse', 'HEAD']);
    const listed = seams.capture('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`]);
    const tagged = taggedCommit(listed, tag);
    if (tagged === undefined) {
        seams.run('git', ['tag', '-a', tag, '-m', releaseTitle(version)]);
        seams.run('git', ['push', '--atomic', 'origin', 'HEAD:refs/heads/main', `refs/tags/${tag}`]);
    } else if (tagged !== head) {
        throw new Error(`${tag} already tags ${tagged}, not the release commit ${head}`);
    }
}

function taggedCommit(listing: string, tag: string): string | undefined {
    const refs = new Map(
        listing
            .split('\n')
            .map((line) => line.split('\t'))
            .map(([sha, ref]) => [ref, sha] as const),
    );
    return refs.get(`refs/tags/${tag}^{}`) ?? refs.get(`refs/tags/${tag}`);
}

function publishRelease(input: ReleaseInput, seams: PublishSeams): void {
    const tag = `v${input.version}`;
    const state = seams.releaseState(input.repository, tag);
    if (state === 'published') {
        return;
    }
    if (state === 'absent') {
        const title = releaseTitle(input.version);
        seams.run('gh', [
            'release',
            'create',
            tag,
            '--verify-tag',
            '--draft',
            '--title',
            title,
            '--notes-file',
            input.notes,
            ...input.assets,
        ]);
    } else {
        seams.run('gh', ['release', 'upload', tag, '--clobber', ...input.assets]);
    }
    const uploaded = seams
        .capture('gh', ['release', 'view', tag, '--json', 'assets', '--jq', '.assets[].name'])
        .split('\n')
        .filter((name) => name !== '');
    const missing = input.assets.map((path) => basename(path)).filter((name) => !uploaded.includes(name));
    if (missing.length > 0) {
        throw new Error(`the draft release lacks ${missing.join(', ')}, so it stays a draft`);
    }
    seams.run('gh', ['release', 'edit', tag, '--draft=false']);
}

function startNextVersion(version: string, seams: PublishSeams): void {
    const next = devVersion(version);
    seams.run('git', ['fetch', '--quiet', 'origin', 'main']);
    const manifest = JSON.parse(seams.capture('git', ['show', 'FETCH_HEAD:package.json'])) as {
        readonly version?: string;
    };
    if (manifest.version === next) {
        return;
    }
    if (manifest.version !== version) {
        throw new Error(`main carries ${manifest.version}, neither the release ${version} nor ${next}; set it by hand`);
    }
    seams.run('git', ['checkout', '--quiet', '--detach', 'FETCH_HEAD']);
    seams.setVersion(next);
    seams.commitVersion(`chore(release): start ${next}`, `Development continues toward the release after ${version}.`);
    seams.run('git', ['push', 'origin', 'HEAD:refs/heads/main']);
}

/**
 * Downloads the sums without credentials, a few times while the release propagates: a release is public, so anyone
 * must get exactly what was published.
 */
async function expectPublic(input: ReleaseInput, seams: PublishSeams): Promise<void> {
    const url = `https://github.com/${input.repository}/releases/download/v${input.version}/SHA256SUMS.txt`;
    let status = 0;
    for (let attempt = 0; attempt < PUBLIC_ATTEMPTS; attempt += 1) {
        const download = await seams.download(url);
        status = download.status;
        if (status === 200 && download.text === input.sums) {
            return;
        }
        await seams.wait(5_000);
    }
    throw new Error(`anyone should download ${url} as published, but got HTTP ${status}`);
}

function releaseInput(version: string, notes: string, packages: string): ReleaseInput {
    const base = process.env['GITHUB_SHA'];
    const repository = process.env['GITHUB_REPOSITORY'];
    if (base === undefined || repository === undefined) {
        throw new Error('GITHUB_SHA and GITHUB_REPOSITORY must be set');
    }
    const files = releaseAssets(readdirSync(packages), version).map((name) => join(packages, name));
    const sums = sha256Sums(
        files.map((path) => ({
            name: basename(path),
            sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
        })),
    );
    const sumsFile = join(packages, 'SHA256SUMS.txt');
    writeFileSync(sumsFile, sums);
    return { version, notes, assets: [...files, sumsFile], sums, base, repository };
}

function releaseListing(repository: string, tag: string): readonly string[] {
    const select = `.[] | select(.tag_name == ${JSON.stringify(tag)}) | .draft`;
    return ['api', '--paginate', `repos/${repository}/releases`, '--jq', select];
}

const REAL_SEAMS: PublishSeams = {
    run,
    capture,
    releaseState: (repository, tag) => releaseStateOf(capture('gh', releaseListing(repository, tag)), tag),
    download: async (url) => {
        const response = await fetch(url);
        return { status: response.status, text: await response.text() };
    },
    wait: (milliseconds) => delay(milliseconds),
    setVersion,
    commitVersion,
};

if (import.meta.main) {
    const [version, notes, packages] = process.argv.slice(2);
    if (version === undefined || notes === undefined || packages === undefined) {
        throw new Error('usage: node tools/release/publish.ts <version> <notes file> <packages folder>');
    }
    await publish(releaseInput(version, notes, packages), REAL_SEAMS);
}
