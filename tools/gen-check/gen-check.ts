/**
 * Fails when the protocol files `pnpm gen` just wrote differ from the committed ones, untracked files included, so a
 * Rust protocol change never lands without its TypeScript bindings and fixtures. Run through `pnpm gen:check`; it
 * needs no POSIX shell (Windows, E6).
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/** The generated paths, relative to the repository root. */
export const GENERATED = ['packages/protocol/src/generated', 'protocol/fixtures'] as const;

const ROOT = resolve(import.meta.dirname, '../..');

function porcelain(args: readonly string[]): string {
    return execFileSync('git', [...args, '--', ...GENERATED], { cwd: ROOT, encoding: 'utf8' });
}

if (import.meta.main) {
    if (porcelain(['status', '--porcelain']).trim() !== '') {
        process.stderr.write('generated protocol files differ from the committed ones; commit them\n');
        process.stderr.write(porcelain(['status', '--short']));
        process.exitCode = 1;
    }
}
