/**
 * Fetches the daemons a released app bundled, for the upgrade tests (US-2.5.3): downloads the release's macOS arm64 zip
 * and `SHA256SUMS.txt` with `gh`, checks the zip, and extracts the bundled daemons and their manifest into the build
 * cache, outside git. Run `node tools/test-hosts/fetch-old-daemon.ts [version]`, 0.2.0 by default.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const REPOSITORY_SLUG = 'renatorroliveira/terminal-remote-control';
const RESOURCES = 'Terminal Remote Control.app/Contents/Resources/daemon';
const FILES = ['manifest.json', 'linux-arm64/trcd', 'linux-x64/trcd'] as const;

/** Where a version's daemons are cached, as `apps/desktop/test/soak/old-daemons.ts` reads them. */
export function cacheFolder(version: string, env: Readonly<Record<string, string | undefined>> = process.env): string {
    const root = env['TRC_CACHE_DIR'] ?? join(env['XDG_CACHE_HOME'] ?? join(homedir(), '.cache'), 'trc');
    return join(root, 'daemon', version);
}

/** The SHA-256 that `SHA256SUMS.txt` lists for `asset`, or `undefined`. */
export function listedDigest(sums: string, asset: string): string | undefined {
    const line = sums.split('\n').find((entry) => entry.trimEnd().endsWith(` ${asset}`));
    return line?.split(/\s+/)[0];
}

/** bsdtar, which reads zip files: macOS's, or the one in System32, never a GNU tar found on PATH. */
function bsdtar(): string {
    return process.platform === 'win32'
        ? `${process.env['SystemRoot'] ?? 'C:\\Windows'}\\System32\\tar.exe`
        : '/usr/bin/tar';
}

function fetchDaemons(version: string): string {
    const cache = cacheFolder(version);
    if (existsSync(join(cache, 'manifest.json'))) {
        return `daemon ${version} already in ${cache}`;
    }
    const download = mkdtempSync(join(tmpdir(), 'trc-old-daemon-'));
    try {
        const asset = `TRC-${version}-mac-arm64.zip`;
        execFileSync(
            'gh',
            [
                'release',
                'download',
                `v${version}`,
                '--repo',
                REPOSITORY_SLUG,
                '--dir',
                download,
                '--pattern',
                asset,
                '--pattern',
                'SHA256SUMS.txt',
            ],
            { stdio: 'inherit', windowsHide: true },
        );
        const digest = createHash('sha256')
            .update(readFileSync(join(download, asset)))
            .digest('hex');
        if (digest !== listedDigest(readFileSync(join(download, 'SHA256SUMS.txt'), 'utf8'), asset)) {
            throw new Error(`${asset} does not match SHA256SUMS.txt`);
        }
        execFileSync(
            bsdtar(),
            ['-xf', join(download, asset), '-C', download, ...FILES.map((file) => `${RESOURCES}/${file}`)],
            { windowsHide: true },
        );
        for (const file of FILES) {
            mkdirSync(join(cache, file, '..'), { recursive: true });
            copyFileSync(join(download, RESOURCES, file), join(cache, file));
        }
        chmodSync(join(cache, 'linux-arm64/trcd'), 0o755);
        chmodSync(join(cache, 'linux-x64/trcd'), 0o755);
        return `daemon ${version} extracted into ${cache}`;
    } finally {
        rmSync(download, { recursive: true, force: true });
    }
}

if (import.meta.main) {
    try {
        process.stdout.write(`${fetchDaemons(process.argv[2] ?? '0.2.0')}\n`);
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    }
}
