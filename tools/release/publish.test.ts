import { describe, expect, it } from 'vitest';
import {
    type Download,
    type PublishSeams,
    publish,
    type ReleaseInput,
    type ReleaseState,
    releaseStateOf,
} from './publish.ts';

const INPUT: ReleaseInput = {
    version: '0.2.0',
    notes: '/tmp/release/notes.md',
    assets: ['/tmp/packages/TRC-0.2.0-mac-arm64.dmg', '/tmp/packages/SHA256SUMS.txt'],
    sums: 'abc  TRC-0.2.0-mac-arm64.dmg\n',
    base: 'base1',
    repository: 'owner/trc',
};

const FRESH: ReadonlyMap<string, string | undefined> = new Map([
    ['git rev-parse HEAD~1', 'base1'],
    ['git rev-parse HEAD', 'release1'],
    ['git diff --name-only HEAD~1 HEAD', 'Cargo.lock\nCargo.toml\npackage.json'],
    ['git ls-remote --tags origin', ''],
    ['gh release view v0.2.0 --json isDraft', undefined],
    ['gh release view v0.2.0 --json assets', 'TRC-0.2.0-mac-arm64.dmg\nSHA256SUMS.txt'],
    ['git show FETCH_HEAD:package.json', '{ "version": "0.2.0" }'],
]);

/** Records what publishing runs, and answers its queries by command prefix. */
class FakeRelease implements PublishSeams {
    readonly calls: string[] = [];
    /** The repository and tag of each release-state lookup. */
    readonly states: string[] = [];
    readonly answers: Map<string, string | undefined>;
    readonly downloads: Download[];

    constructor(changes: Readonly<Record<string, string | undefined>> = {}, downloads?: readonly Download[]) {
        this.answers = new Map([...FRESH, ...Object.entries(changes)]);
        this.downloads = [...(downloads ?? [{ status: 200, text: INPUT.sums }])];
    }

    run(command: string, args: readonly string[]): void {
        this.calls.push([command, ...args].join(' '));
    }

    capture(command: string, args: readonly string[]): string {
        const line = [command, ...args].join(' ');
        const answer = this.#answer(line);
        if (answer === undefined) {
            throw new Error(`failed: ${line}`);
        }
        return answer;
    }

    releaseState(repository: string, tag: string): ReleaseState {
        this.states.push(`${repository} ${tag}`);
        const answer = this.#answer(`gh release view ${tag} --json isDraft`);
        if (answer === 'unreachable') {
            throw new Error('gh: HTTP 502');
        }
        return answer === undefined ? 'absent' : answer === 'true' ? 'draft' : 'published';
    }

    download(url: string): Promise<Download> {
        this.calls.push(`download ${url}`);
        return Promise.resolve(this.downloads.shift() ?? { status: 404, text: '' });
    }

    wait(): Promise<void> {
        return Promise.resolve();
    }

    setVersion(version: string): void {
        this.calls.push(`set ${version}`);
    }

    commitVersion(subject: string): void {
        this.calls.push(`commit ${subject}`);
    }

    #answer(line: string): string | undefined {
        const key = [...this.answers.keys()].find((prefix) => line === prefix || line.startsWith(`${prefix} `));
        if (key === undefined) {
            throw new Error(`unexpected command: ${line}`);
        }
        return this.answers.get(key);
    }
}

const SUMS_URL = 'download https://github.com/owner/trc/releases/download/v0.2.0/SHA256SUMS.txt';

describe('publish (P-21, D-42)', () => {
    it('tags and pushes, publishes a draft once every asset is up, then starts the next version', async () => {
        const release = new FakeRelease();
        await publish(INPUT, release);
        expect(release.calls).toEqual([
            'git tag -a v0.2.0 -m TRC v0.2.0',
            'git push --atomic origin HEAD:refs/heads/main refs/tags/v0.2.0',
            'gh release create v0.2.0 --verify-tag --draft --title TRC v0.2.0 --notes-file /tmp/release/notes.md /tmp/packages/TRC-0.2.0-mac-arm64.dmg /tmp/packages/SHA256SUMS.txt',
            'gh release edit v0.2.0 --draft=false',
            'git fetch --quiet origin main',
            'git checkout --quiet --detach FETCH_HEAD',
            'set 0.3.0-dev',
            'commit chore(release): start 0.3.0-dev',
            'git push origin HEAD:refs/heads/main',
            SUMS_URL,
        ]);
        expect(release.states).toEqual(['owner/trc v0.2.0']);
    });

    it('refuses a release commit that is not on the workflow’s commit, or that changes more than versions', async () => {
        await expect(publish(INPUT, new FakeRelease({ 'git rev-parse HEAD~1': 'other' }))).rejects.toThrow(
            /must sit on base1/,
        );
        const extra = new FakeRelease({ 'git diff --name-only HEAD~1 HEAD': 'package.json\n.github/workflows/ci.yml' });
        await expect(publish(INPUT, extra)).rejects.toThrow(/only the version files.*ci\.yml/);
        expect(extra.calls).toEqual([]);
    });
});

describe('publish: resuming and refusing (P-21, D-42)', () => {
    it('resumes a run that stopped after the push: uploads to the draft again and publishes it', async () => {
        const release = new FakeRelease({
            'git ls-remote --tags origin': 'tagobj\trefs/tags/v0.2.0\nrelease1\trefs/tags/v0.2.0^{}',
            'gh release view v0.2.0 --json isDraft': 'true',
        });
        await publish(INPUT, release);
        expect(release.calls.slice(0, 2)).toEqual([
            'gh release upload v0.2.0 --clobber /tmp/packages/TRC-0.2.0-mac-arm64.dmg /tmp/packages/SHA256SUMS.txt',
            'gh release edit v0.2.0 --draft=false',
        ]);
    });

    it('skips every step a previous run finished', async () => {
        const release = new FakeRelease({
            'git ls-remote --tags origin': 'tagobj\trefs/tags/v0.2.0\nrelease1\trefs/tags/v0.2.0^{}',
            'gh release view v0.2.0 --json isDraft': 'false',
            'git show FETCH_HEAD:package.json': '{ "version": "0.3.0-dev" }',
        });
        await publish(INPUT, release);
        expect(release.calls).toEqual(['git fetch --quiet origin main', SUMS_URL]);
    });

    it('stops, creating no second draft, when gh cannot say whether the release exists', async () => {
        const release = new FakeRelease({ 'gh release view v0.2.0 --json isDraft': 'unreachable' });
        await expect(publish(INPUT, release)).rejects.toThrow(/HTTP 502/);
        expect(release.calls.some((call) => call.startsWith('gh release create'))).toBe(false);
    });

    it('refuses a tag on another commit, a draft that lacks an asset, and a main it cannot place', async () => {
        const moved = { 'git ls-remote --tags origin': 'tagobj\trefs/tags/v0.2.0\nelse1\trefs/tags/v0.2.0^{}' };
        await expect(publish(INPUT, new FakeRelease(moved))).rejects.toThrow(/already tags else1/);
        const partial = new FakeRelease({ 'gh release view v0.2.0 --json assets': 'SHA256SUMS.txt' });
        await expect(publish(INPUT, partial)).rejects.toThrow(/lacks TRC-0\.2\.0-mac-arm64\.dmg/);
        expect(partial.calls).not.toContain('gh release edit v0.2.0 --draft=false');
        const odd = new FakeRelease({ 'git show FETCH_HEAD:package.json': '{ "version": "0.9.0-dev" }' });
        await expect(publish(INPUT, odd)).rejects.toThrow(/main carries 0\.9\.0-dev/);
    });

    it('waits while the release propagates, and fails when anyone still cannot download what it published', async () => {
        const slow = new FakeRelease({}, [
            { status: 404, text: '' },
            { status: 200, text: INPUT.sums },
        ]);
        await publish(INPUT, slow);
        expect(slow.calls.filter((call) => call === SUMS_URL)).toHaveLength(2);
        const wrong = new FakeRelease({}, []);
        await expect(publish(INPUT, wrong)).rejects.toThrow(/got HTTP 404/);
        expect(wrong.calls).toContain('git push origin HEAD:refs/heads/main');
    });
});

describe('releaseStateOf', () => {
    it('reads the drafts flag of the tag’s one release from a listing that includes drafts, or none', () => {
        expect(releaseStateOf('', 'v0.2.0')).toBe('absent');
        expect(releaseStateOf('true', 'v0.2.0')).toBe('draft');
        expect(releaseStateOf('false', 'v0.2.0')).toBe('published');
    });

    it('fails on two releases for the tag, or on anything but true or false', () => {
        expect(() => releaseStateOf('true\ntrue', 'v0.2.0')).toThrow(/2 releases/);
        expect(() => releaseStateOf('null', 'v0.2.0')).toThrow(/null/);
    });
});
