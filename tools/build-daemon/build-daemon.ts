/**
 * Builds the Linux daemons with cargo-zigbuild and writes them, with `manifest.json`, to
 * `apps/desktop/resources/daemon/` for the app to bundle and upload (US-1.4.2, SEC-04.2). Run `pnpm build:daemon`.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** A bundled daemon platform and the Rust target that builds it. */
export interface DaemonTarget {
    readonly platform: 'linux-x64' | 'linux-arm64';
    readonly triple: string;
}

/** A built binary as the manifest describes it. */
export interface BuiltBinary {
    readonly platform: DaemonTarget['platform'];
    readonly sha256: string;
    readonly size: number;
}

/** Every daemon the app bundles (E1: Linux x86_64 and arm64). */
export const DAEMON_TARGETS: readonly DaemonTarget[] = [
    { platform: 'linux-x64', triple: 'x86_64-unknown-linux-musl' },
    { platform: 'linux-arm64', triple: 'aarch64-unknown-linux-musl' },
];

/** The text of `manifest.json`. */
export function manifestFor(version: string, binaries: readonly BuiltBinary[]): string {
    const entries = binaries.map(({ platform, sha256, size }) => [platform, { sha256, size }] as const);
    return `${JSON.stringify({ version, binaries: Object.fromEntries(entries) }, null, 4)}\n`;
}

/** Builds every target into `output` and writes the manifest. */
export function buildDaemons(repository: string, output: string): void {
    rmSync(output, { recursive: true, force: true });
    const binaries = DAEMON_TARGETS.map((target) => buildTarget(repository, output, target));
    writeFileSync(join(output, 'manifest.json'), manifestFor(daemonVersion(repository), binaries));
}

function buildTarget(repository: string, output: string, target: DaemonTarget): BuiltBinary {
    execFileSync('cargo', ['zigbuild', '--quiet', '--release', '--target', target.triple, '-p', 'trcd'], {
        cwd: repository,
        stdio: 'inherit',
    });
    const destination = join(output, target.platform, 'trcd');
    mkdirSync(join(output, target.platform), { recursive: true });
    copyFileSync(join(repository, 'target', target.triple, 'release', 'trcd'), destination);
    const bytes = readFileSync(destination);
    return { platform: target.platform, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
}

function daemonVersion(repository: string): string {
    const metadata = execFileSync('cargo', ['metadata', '--format-version', '1', '--no-deps'], {
        cwd: repository,
        encoding: 'utf8',
    });
    const packages = (JSON.parse(metadata) as { readonly packages: readonly { name: string; version: string }[] })
        .packages;
    const daemon = packages.find((entry) => entry.name === 'trcd');
    if (daemon === undefined) {
        throw new Error('The workspace has no trcd package.');
    }
    return daemon.version;
}

if (import.meta.main) {
    const repository = process.cwd();
    buildDaemons(repository, join(repository, 'apps/desktop/resources/daemon'));
}
