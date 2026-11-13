/**
 * Starts the release workflow on GitHub and watches it (P-21, D-42): `pnpm release <major|minor|patch> [--dry-run]`.
 * The workflow does the rest; a dry run builds and checks everything without pushing or publishing. The same run
 * starts from the Actions tab's Run workflow button.
 */
import { setTimeout as delay } from 'node:timers/promises';
import { parseArguments, type ReleaseOptions } from './arguments.ts';
import { capture, run } from './repository.ts';

const WORKFLOW = 'release.yml';

/** Dispatches the workflow from `main` and follows its run to the end. */
export async function release(options: ReleaseOptions): Promise<void> {
    run('gh', ['auth', 'status']);
    const before = latestRun();
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
    const started = await newRun(before);
    run('gh', ['run', 'watch', started, '--exit-status']);
}

function latestRun(): string {
    return capture('gh', [
        'run',
        'list',
        '--workflow',
        WORKFLOW,
        '--limit',
        '1',
        '--json',
        'databaseId',
        '--jq',
        '.[0].databaseId // ""',
    ]);
}

async function newRun(before: string): Promise<string> {
    for (let attempt = 0; attempt < 30; attempt += 1) {
        const latest = latestRun();
        if (latest !== '' && latest !== before) {
            return latest;
        }
        await delay(2_000);
    }
    throw new Error(`the ${WORKFLOW} run did not start within a minute`);
}

if (import.meta.main) {
    await release(parseArguments(process.argv.slice(2)));
}
