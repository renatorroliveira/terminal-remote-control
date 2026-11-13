import type { Bump } from './versions.ts';

/** What `pnpm release` was asked to do. */
export interface ReleaseOptions {
    readonly bump: Bump;
    /** Print the version and the notes, and change nothing. */
    readonly dryRun: boolean;
}

const USAGE = 'usage: pnpm release <major|minor|patch> [--dry-run]';
const BUMPS: readonly string[] = ['major', 'minor', 'patch'];

/** The options in the command line arguments, or an error with the usage. */
export function parseArguments(argv: readonly string[]): ReleaseOptions {
    const [bump, ...rest] = argv;
    const dryRun = rest.length === 1 && rest[0] === '--dry-run';
    if (bump === undefined || !BUMPS.includes(bump) || (rest.length > 0 && !dryRun)) {
        throw new Error(USAGE);
    }
    return { bump: bump as Bump, dryRun };
}
