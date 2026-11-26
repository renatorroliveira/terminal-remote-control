import { describe, expect, it } from 'vitest';
import { rustCheckCommands } from './rust-check.ts';

describe('rustCheckCommands', () => {
    it('formats, lints and tests the whole workspace on macOS and Linux', () => {
        for (const platform of ['darwin', 'linux'] as const) {
            expect(rustCheckCommands(platform)).toEqual([
                ['cargo', 'fmt', '--all', '--check'],
                ['cargo', 'clippy', '--all-targets', '--quiet', '--workspace', '--', '-D', 'warnings'],
                ['cargo', 'nextest', 'run', '--workspace', '--cargo-quiet'],
            ]);
        }
    });

    it('lints and tests the workspace natively on Windows, the Unix code of the daemon for Linux, and uia-probe (D-62, D-66, D-69)', () => {
        expect(rustCheckCommands('win32')).toEqual([
            ['cargo', 'fmt', '--all', '--check'],
            ['cargo', 'clippy', '--all-targets', '--quiet', '--workspace', '--', '-D', 'warnings'],
            [
                'cargo',
                'clippy',
                '--all-targets',
                '--quiet',
                '-p',
                'trcd',
                '--target',
                'x86_64-unknown-linux-musl',
                '--',
                '-D',
                'warnings',
            ],
            ['cargo', 'fmt', '--check', '--manifest-path', 'tools/uia-probe/Cargo.toml'],
            [
                'cargo',
                'clippy',
                '--all-targets',
                '--quiet',
                '--manifest-path',
                'tools/uia-probe/Cargo.toml',
                '--',
                '-D',
                'warnings',
            ],
            ['cargo', 'nextest', 'run', '--workspace', '--cargo-quiet'],
        ]);
    });
});
