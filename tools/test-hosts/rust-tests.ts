/**
 * Builds the daemon's tests for Linux musl and runs every test binary as root in Ubuntu, Alpine and Rocky containers,
 * so the Linux-only and other-user checks run too, then runs each bundled Linux daemon's `--version`. Extra arguments
 * go to each test binary. Run `pnpm test:daemon` (D-69).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import native, { join, type posix } from 'node:path';
import { dockerEnvironment, REPOSITORY } from './hosts.ts';

/** The images the tests run in. */
export const IMAGES: readonly string[] = ['ubuntu:24.04', 'alpine:3.23', 'rockylinux/rockylinux:9'];

/** Where the container sees the repository's `target` folder. */
const TARGET_MOUNT = '/target';
const BUNDLES = [
    ['linux-x64', 'amd64'],
    ['linux-arm64', 'arm64'],
] as const;

/** The musl target matching this machine's architecture, which the local containers run natively. */
export function muslTarget(arch: string = process.arch): string {
    if (arch === 'arm64') {
        return 'aarch64-unknown-linux-musl';
    }
    if (arch === 'x64') {
        return 'x86_64-unknown-linux-musl';
    }
    throw new Error(`rust-tests: unsupported architecture ${arch}`);
}

/** The test executables in cargo's `--message-format=json` output. */
export function testExecutables(cargoJson: string): readonly string[] {
    return cargoJson
        .split('\n')
        .filter((line) => line.startsWith('{'))
        .map(
            (line) => JSON.parse(line) as { reason?: string; executable?: string | null; profile?: { test?: boolean } },
        )
        .filter((message) => message.reason === 'compiler-artifact' && message.profile?.test === true)
        .flatMap((message) => (typeof message.executable === 'string' ? [message.executable] : []));
}

/** A binary under `target` as the container sees it, through {@link TARGET_MOUNT}, with this OS's path rules. */
export function containerPath(binary: string, target: string, paths: Pick<typeof posix, 'relative'> = native): string {
    return `${TARGET_MOUNT}/${paths.relative(target, binary).replaceAll('\\', '/')}`;
}

/** The Dockerfile line that adds the shells TRC integrates (US-5.1); docker keeps the layer for later runs. */
export function shellsFor(image: string): string {
    if (image.startsWith('ubuntu')) {
        return 'RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends zsh fish && rm -rf /var/lib/apt/lists/*';
    }
    if (image.startsWith('alpine')) {
        return 'RUN apk add --no-cache bash zsh fish';
    }
    return 'RUN dnf install -y --setopt=install_weak_deps=False zsh && dnf clean all';
}

/** The `sh -c` script that runs every binary in a container, stopping at the first failure. */
export function runScript(binaries: readonly string[]): string {
    return [
        'cd /tmp',
        `for binary in ${binaries.map((binary) => `'${binary}'`).join(' ')}; do`,
        '    "$binary" --test-threads=8 "$@" >/tmp/out 2>&1 || { cat /tmp/out; exit 1; }',
        '    printf "%s: %s\\n" "$(basename "$binary")" "$(grep "^test result" /tmp/out)"',
        'done',
    ].join('\n');
}

function say(line: string): void {
    process.stdout.write(`${line}\n`);
}

function run(program: string, args: readonly string[], input?: string): void {
    const stdin = input === undefined ? 'inherit' : 'pipe';
    const result = spawnSync(program, args, { env: dockerEnvironment(), stdio: [stdin, 'inherit', 'inherit'], input });
    if (result.status !== 0) {
        throw new Error(`${program} ${args.slice(0, 2).join(' ')} failed`);
    }
}

function buildTests(target: string): readonly string[] {
    const cargoJson = execFileSync(
        'cargo',
        [
            'zigbuild',
            '--quiet',
            '--release',
            '--target',
            muslTarget(),
            '-p',
            'trcd',
            '--tests',
            '--message-format=json',
        ],
        { cwd: REPOSITORY, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] },
    );
    return testExecutables(cargoJson).map((binary) => containerPath(binary, target));
}

function runInImages(target: string, binaries: readonly string[], extra: readonly string[]): void {
    for (const image of IMAGES) {
        say(`rust-tests: ${image}`);
        const tag = `trc-rust-tests-${image.replaceAll(/[:/]/g, '-')}`;
        run('docker', ['build', '-q', '-t', tag, '-'], `FROM ${image}\n${shellsFor(image)}\n`);
        const binary = `TRC_TEST_TRCD=${TARGET_MOUNT}/${muslTarget()}/release/trcd`;
        const mount = `${target}:${TARGET_MOUNT}:ro`;
        run('docker', [
            'run',
            '--rm',
            '-v',
            mount,
            '-e',
            binary,
            tag,
            'sh',
            '-c',
            runScript(binaries),
            'rust-tests',
            ...extra,
        ]);
    }
}

function checkBundles(): void {
    for (const [platform, dockerPlatform] of BUNDLES) {
        const folder = join(REPOSITORY, 'apps/desktop/resources/daemon', platform);
        if (existsSync(join(folder, 'trcd'))) {
            say(`rust-tests: bundled ${platform}:`);
            const image = ['alpine:3.23', '/d/trcd', '--version'];
            run('docker', ['run', '--rm', '--platform', `linux/${dockerPlatform}`, '-v', `${folder}:/d:ro`, ...image]);
        }
    }
}

if (import.meta.main) {
    try {
        const target = join(REPOSITORY, 'target');
        runInImages(target, buildTests(target), process.argv.slice(2));
        checkBundles();
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    }
}
