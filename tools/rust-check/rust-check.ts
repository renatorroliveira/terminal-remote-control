/**
 * The Rust part of `pnpm check`: rustfmt, clippy with warnings denied, and nextest over the workspace. The daemon,
 * `trcd`, builds only for Unix until the Windows daemon arrives (US-6.2), so on Windows clippy checks it against the
 * Linux musl target it ships for, without linking, and every other crate is linted and tested natively. Run
 * `pnpm rust:check`.
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

/** A program and its arguments. */
export type Command = readonly string[];

const DENY_WARNINGS = ['--', '-D', 'warnings'] as const;

/** The commands that check the Rust workspace on `platform`. */
export function rustCheckCommands(platform: NodeJS.Platform): readonly Command[] {
    const fmt = ['cargo', 'fmt', '--all', '--check'];
    const clippy = ['cargo', 'clippy', '--all-targets', '--quiet'];
    if (platform !== 'win32') {
        return [
            fmt,
            [...clippy, '--workspace', ...DENY_WARNINGS],
            ['cargo', 'nextest', 'run', '--workspace', '--cargo-quiet'],
        ];
    }
    return [
        fmt,
        [...clippy, '--workspace', '--exclude', 'trcd', ...DENY_WARNINGS],
        [...clippy, '-p', 'trcd', '--target', 'x86_64-unknown-linux-musl', ...DENY_WARNINGS],
        ['cargo', 'nextest', 'run', '--workspace', '--exclude', 'trcd', '--cargo-quiet'],
    ];
}

if (import.meta.main) {
    const root = resolve(import.meta.dirname, '../..');
    for (const [program = '', ...args] of rustCheckCommands(process.platform)) {
        const { status, error } = spawnSync(program, args, { cwd: root, stdio: 'inherit' });
        if (error !== undefined) {
            process.stderr.write(`cannot run ${program}: ${error.message}\n`);
        }
        if (status !== 0) {
            process.exitCode = status ?? 1;
            break;
        }
    }
}
