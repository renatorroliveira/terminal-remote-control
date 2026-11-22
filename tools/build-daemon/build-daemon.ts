/**
 * Builds the daemons the app bundles and writes them, with `manifest.json`, to `apps/desktop/resources/daemon/` for
 * the app to upload and run (US-1.4.2, US-4.5.1, SEC-04.2): the Linux ones with cargo-zigbuild, one universal macOS
 * binary from both Apple slices, joined with `lipo` and signed ad hoc, as arm64 requires, and on Windows the
 * `trcd.exe` of this architecture, which runs the app's SSH helpers there (D-66). The Linux daemons build everywhere,
 * the macOS one only on macOS and the Windows one only on Windows. Run `pnpm build:daemon`; `--add <platform>` builds
 * one platform into the existing bundle, as a release's Windows jobs add theirs to the macOS job's daemons.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** A bundled daemon platform and the Rust targets its binary is built from. */
export interface DaemonBuild {
    readonly platform: 'linux-x64' | 'linux-arm64' | 'darwin-universal' | 'windows-x64' | 'windows-arm64';
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

/** Every daemon the app bundles: Linux x86_64 and arm64 (E1), macOS on both (E4), and Windows x64 and arm64 (E6). */
export const DAEMON_BUILDS: readonly DaemonBuild[] = [
    { platform: 'linux-x64', triples: ['x86_64-unknown-linux-musl'] },
    { platform: 'linux-arm64', triples: ['aarch64-unknown-linux-musl'] },
    { platform: 'darwin-universal', triples: ['aarch64-apple-darwin', 'x86_64-apple-darwin'] },
    { platform: 'windows-x64', triples: ['x86_64-pc-windows-msvc'] },
    { platform: 'windows-arm64', triples: ['aarch64-pc-windows-msvc'] },
];

/**
 * The daemons a machine running `host` on `arch` builds: the Linux ones everywhere; the universal macOS one on macOS,
 * as `lipo` and `codesign` exist only there (D-54); and on Windows the `trcd.exe` of its own architecture, with MSVC.
 */
export function buildsFor(host: NodeJS.Platform, arch: string = process.arch): readonly DaemonBuild[] {
    const windows = `windows-${arch === 'arm64' ? 'arm64' : 'x64'}`;
    return DAEMON_BUILDS.filter(
        ({ platform }) =>
            platform.startsWith('linux-') ||
            (host === 'darwin' && platform === 'darwin-universal') ||
            (host === 'win32' && platform === windows),
    );
}

/** The binary's file name: `trcd.exe` on Windows, `trcd` elsewhere. */
export function binaryName(build: DaemonBuild): string {
    return build.platform.startsWith('windows-') ? 'trcd.exe' : 'trcd';
}

/** The text of `manifest.json`. */
export function manifestFor(version: string, binaries: readonly BuiltBinary[]): string {
    const entries = binaries.map(({ platform, sha256, size }) => [platform, { sha256, size }] as const);
    return `${JSON.stringify({ version, binaries: Object.fromEntries(entries) }, null, 4)}\n`;
}

/**
 * The commands that build a platform's binary: cargo-zigbuild for Linux and cargo for Windows, whose binary
 * `builtBinary` names, and for macOS cargo for each slice, `lipo` to join them at `destination`, and an ad-hoc
 * signature over the joined binary.
 */
export function buildCommands(build: DaemonBuild, destination: string): readonly BuildCommand[] {
    if (build.platform.startsWith('windows-')) {
        return build.triples.map((triple) => cargo('build', triple));
    }
    if (build.platform !== 'darwin-universal') {
        return build.triples.map((triple) => cargo('zigbuild', triple));
    }
    const built = build.triples.map((triple) => `target/${triple}/release/trcd`);
    return [
        ...build.triples.map((triple) => cargo('build', triple)),
        ['lipo', '-create', '-output', destination, ...built],
        ['codesign', '--force', '--sign', '-', destination],
    ];
}

/** The binary a Linux or Windows build leaves under `target/`, copied to the destination; `lipo` writes the macOS one. */
export function builtBinary(build: DaemonBuild): string | undefined {
    const [triple] = build.triples;
    return build.platform === 'darwin-universal' || triple === undefined
        ? undefined
        : `target/${triple}/release/${binaryName(build)}`;
}

/** Builds every platform this machine can into `output` and writes the manifest. */
export function buildDaemons(repository: string, output: string): void {
    rmSync(output, { recursive: true, force: true });
    const builds = buildsFor(process.platform);
    if (!builds.some((build) => build.platform === 'darwin-universal')) {
        console.warn('Skipping the macOS daemon: it builds only on macOS. This bundle cannot install on macOS hosts.');
    }
    const binaries = builds.map((build) => buildPlatform(repository, output, build));
    writeFileSync(join(output, 'manifest.json'), manifestFor(daemonVersion(repository), binaries));
}

/** Builds `platform` into the bundle at `output` and adds it to that bundle's manifest, replacing any earlier entry. */
export function addDaemon(repository: string, output: string, platform: string): void {
    const build = DAEMON_BUILDS.find((candidate) => candidate.platform === platform);
    if (build === undefined) {
        throw new Error(`Unknown daemon platform: ${platform}`);
    }
    const manifest = JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8')) as {
        readonly version: string;
        readonly binaries: Readonly<Record<string, { readonly sha256: string; readonly size: number }>>;
    };
    const kept = Object.entries(manifest.binaries)
        .filter(([listed]) => listed !== platform)
        .map(([listed, binary]) => ({ ...binary, platform: listed as DaemonBuild['platform'] }));
    const added = buildPlatform(repository, output, build);
    writeFileSync(join(output, 'manifest.json'), manifestFor(manifest.version, [...kept, added]));
}

function cargo(command: 'build' | 'zigbuild', triple: string): BuildCommand {
    return ['cargo', command, '--locked', '--quiet', '--release', '--target', triple, '-p', 'trcd'];
}

function buildPlatform(repository: string, output: string, build: DaemonBuild): BuiltBinary {
    const destination = join(output, build.platform, binaryName(build));
    mkdirSync(join(output, build.platform), { recursive: true });
    for (const [program, ...args] of buildCommands(build, destination)) {
        execFileSync(program ?? '', args, { cwd: repository, stdio: 'inherit' });
    }
    const built = builtBinary(build);
    if (built !== undefined) {
        copyFileSync(join(repository, built), destination);
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
    const output = join(repository, 'apps/desktop/resources/daemon');
    const [flag, platform] = process.argv.slice(2);
    if (flag === '--add' && platform !== undefined) {
        addDaemon(repository, output, platform);
    } else {
        buildDaemons(repository, output);
    }
}
