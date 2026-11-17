/**
 * Builds the daemons the app bundles and writes them, with `manifest.json`, to `apps/desktop/resources/daemon/` for
 * the app to upload and run (US-1.4.2, US-4.5.1, SEC-04.2): the Linux ones with cargo-zigbuild, and one universal
 * macOS binary from both Apple slices, joined with `lipo` and signed ad hoc, as arm64 requires. Runs on macOS. Run
 * `pnpm build:daemon`.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** A bundled daemon platform and the Rust targets its binary is built from. */
export interface DaemonBuild {
    readonly platform: 'linux-x64' | 'linux-arm64' | 'darwin-universal';
    readonly triples: readonly string[];
}

/** A built binary as the manifest describes it. */
export interface BuiltBinary {
    readonly platform: DaemonBuild['platform'];
    readonly sha256: string;
    readonly size: number;
}

/** A program and its arguments, run in the repository. */
export type BuildCommand = readonly string[];

/** Every daemon the app bundles: Linux x86_64 and arm64 (E1), and macOS on both (E4). */
export const DAEMON_BUILDS: readonly DaemonBuild[] = [
    { platform: 'linux-x64', triples: ['x86_64-unknown-linux-musl'] },
    { platform: 'linux-arm64', triples: ['aarch64-unknown-linux-musl'] },
    { platform: 'darwin-universal', triples: ['aarch64-apple-darwin', 'x86_64-apple-darwin'] },
];

/** The text of `manifest.json`. */
export function manifestFor(version: string, binaries: readonly BuiltBinary[]): string {
    const entries = binaries.map(({ platform, sha256, size }) => [platform, { sha256, size }] as const);
    return `${JSON.stringify({ version, binaries: Object.fromEntries(entries) }, null, 4)}\n`;
}

/**
 * The commands that build a platform's binary at `destination`: cargo-zigbuild then a copy for Linux, and for macOS
 * cargo for each slice, `lipo` to join them, and an ad-hoc signature over the joined binary.
 */
export function buildCommands(build: DaemonBuild, destination: string): readonly BuildCommand[] {
    const built = build.triples.map((triple) => `target/${triple}/release/trcd`);
    if (build.platform !== 'darwin-universal') {
        return [...build.triples.map((triple) => cargo('zigbuild', triple)), ['cp', ...built, destination]];
    }
    return [
        ...build.triples.map((triple) => cargo('build', triple)),
        ['lipo', '-create', '-output', destination, ...built],
        ['codesign', '--force', '--sign', '-', destination],
    ];
}

/** Builds every platform into `output` and writes the manifest. */
export function buildDaemons(repository: string, output: string): void {
    rmSync(output, { recursive: true, force: true });
    const binaries = DAEMON_BUILDS.map((build) => buildPlatform(repository, output, build));
    writeFileSync(join(output, 'manifest.json'), manifestFor(daemonVersion(repository), binaries));
}

function cargo(command: 'build' | 'zigbuild', triple: string): BuildCommand {
    return ['cargo', command, '--locked', '--quiet', '--release', '--target', triple, '-p', 'trcd'];
}

function buildPlatform(repository: string, output: string, build: DaemonBuild): BuiltBinary {
    const destination = join(output, build.platform, 'trcd');
    mkdirSync(join(output, build.platform), { recursive: true });
    for (const [program, ...args] of buildCommands(build, destination)) {
        execFileSync(program ?? '', args, { cwd: repository, stdio: 'inherit' });
    }
    const bytes = readFileSync(destination);
    return { platform: build.platform, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
}

function daemonVersion(repository: string): string {
    const metadata = execFileSync('cargo', ['metadata', '--locked', '--format-version', '1', '--no-deps'], {
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
