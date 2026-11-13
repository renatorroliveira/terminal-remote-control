/**
 * Starts the release workflow on GitHub and watches it (P-21, D-42): `pnpm release <major|minor|patch> [--dry-run]`.
 * The workflow does the rest; a dry run builds and checks everything without pushing or publishing. The same run
 * starts from the Actions tab's Run workflow button.
 */
import { setTimeout as delay } from 'node:timers/promises';
import { parseArguments, type ReleaseOptions } from './arguments.ts';
import { capture, run } from './repository.ts';

/** A workflow run as `gh run list --json databaseId,createdAt` lists it. */
export interface ListedRun {
    readonly databaseId: number;
    readonly createdAt: string;
}

const WORKFLOW = 'release.yml';
const CLOCK_SKEW_MS = 10_000;

/** Dispatches the workflow from `main`, follows the caller's run to the end, and fails when it did not release. */
export async function release(options: ReleaseOptions): Promise<void> {
    run('gh', ['auth', 'status']);
    const user = capture('gh', ['api', 'user', '--jq', '.login']);
    const since = Date.now() - CLOCK_SKEW_MS;
    run('gh', [
        'workflow',
        'run',
        WORKFLOW,
        '--ref',
        'main',
        '-f',
        `bump=${options.bump}`,
        '-f',
        `dry-run=${options.dryRun}`,
    ]);
    const started = await ownRun(user, since);
    run('gh', ['run', 'watch', started, '--exit-status']);
    const problem = unpublished(options, publishConclusion(started));
    if (problem !== undefined) {
        throw new Error(problem);
    }
}

/** The newest run created at or after `since`, from runs listed newest first; undefined when none is. */
export function startedRun(runs: readonly ListedRun[], since: number): string | undefined {
    const found = runs.find((listed) => Date.parse(listed.createdAt) >= since);
    return found === undefined ? undefined : String(found.databaseId);
}

/** Why a finished run did not release, from its publish job's conclusion; undefined when it did or was a dry run. */
export function unpublished(options: ReleaseOptions, conclusion: string): string | undefined {
    if (options.dryRun || conclusion === 'success') {
        return undefined;
    }
    const outcome = conclusion === '' ? 'never ran' : `ended ${conclusion}`;
    return `the release run finished, but its publish job ${outcome}, so nothing was released`;
}

async function ownRun(user: string, since: number): Promise<string> {
    for (let attempt = 0; attempt < 30; attempt += 1) {
        const listed = capture('gh', [
            'run',
            'list',
            '--workflow',
            WORKFLOW,
            '--event',
            'workflow_dispatch',
            '--user',
            user,
            '--limit',
            '5',
            '--json',
            'databaseId,createdAt',
        ]);
        const found = startedRun(JSON.parse(listed) as readonly ListedRun[], since);
        if (found !== undefined) {
            return found;
        }
        await delay(2_000);
    }
    throw new Error(`the ${WORKFLOW} run did not start within a minute`);
}

function publishConclusion(runId: string): string {
    return capture('gh', [
        'run',
        'view',
        runId,
        '--json',
        'jobs',
        '--jq',
        '[.jobs[] | select(.name == "publish") | .conclusion][0] // ""',
    ]);
}

if (import.meta.main) {
    await release(parseArguments(process.argv.slice(2)));
}
