import { execFileSync } from 'node:child_process';

/**
 * The commit a build comes from, for the About panel: the short SHA of `HEAD` in `root`, with `-dirty` when the
 * tree has uncommitted changes, or `unknown` outside a git repository.
 */
export function buildCommit(root: string): string {
    try {
        const sha = git(root, ['rev-parse', '--short', 'HEAD']);
        return describeCommit(sha, git(root, ['status', '--porcelain']));
    } catch {
        return 'unknown';
    }
}

/** A short SHA, marked `-dirty` when `git status --porcelain` printed anything. */
export function describeCommit(sha: string, porcelain: string): string {
    return porcelain.trim() === '' ? sha : `${sha}-dirty`;
}

function git(root: string, args: readonly string[]): string {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}
