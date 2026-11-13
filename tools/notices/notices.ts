/**
 * Writes `apps/desktop/resources/notices/THIRD_PARTY_NOTICES.txt`, the licenses of everything the app ships besides
 * Electron and Chromium (ST-20): the production npm packages, the crates linked into the daemon, libghostty-vt and
 * the libraries built into it, and the bundled fonts. `pnpm notices` writes it; `pnpm notices --check` fails while
 * the committed file is stale. Needs `pnpm install`, `cargo` and `tools/fetch-libghostty.sh`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
    type CargoMetadata,
    formatNotices,
    isLicenseFile,
    type Notice,
    npmPackages,
    rustPackages,
    type ShippedPackage,
} from './notices-format.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const DESKTOP = join(ROOT, 'apps/desktop');
const OUTPUT = join(DESKTOP, 'resources/notices/THIRD_PARTY_NOTICES.txt');
const FONTS = join(DESKTOP, 'src/renderer/ui/fonts');
const DAEMON_TARGETS = ['x86_64-unknown-linux-musl', 'aarch64-unknown-linux-musl'] as const;

/** The notices file's text, from the packages installed and fetched now. */
export function noticesText(): string {
    const packages = [...npm(), ...rust()];
    const notices: readonly Notice[] = [
        ...packages.map((entry) => ({ ...entry, texts: licenseTexts(entry.folder) })),
        ...native(),
        ...fonts(),
    ];
    return `${formatNotices('Terminal Remote Control', notices)}\n`;
}

function npm(): readonly ShippedPackage[] {
    return npmPackages(capture('pnpm', ['licenses', 'list', '--prod', '--json'], DESKTOP));
}

function rust(): readonly ShippedPackage[] {
    const all = DAEMON_TARGETS.flatMap((target) => {
        const args = ['metadata', '--format-version', '1', '--locked', '--filter-platform', target];
        return rustPackages(JSON.parse(capture('cargo', args, ROOT)) as CargoMetadata, 'trcd');
    });
    return [...new Map(all.map((entry) => [`${entry.name}@${entry.version}`, entry])).values()];
}

function native(): readonly Notice[] {
    const version = /^version=(.+)$/m.exec(readFileSync(join(ROOT, 'tools/libghostty.manifest'), 'utf8'))?.[1] ?? '';
    const cache =
        process.env['TRC_CACHE_DIR'] ?? join(process.env['XDG_CACHE_HOME'] ?? join(homedir(), '.cache'), 'trc');
    const source = join(cache, 'libghostty-vt', version, 'src', `libghostty-vt-${version}`);
    const deps = `${source}-deps`;
    const within = `in libghostty-vt ${version}`;
    return [
        { name: 'libghostty-vt', version, license: 'MIT', texts: licenseTexts(source) },
        {
            name: 'Highway',
            version: within,
            license: 'Apache-2.0 OR BSD-3-Clause',
            texts: licenseTexts(zigDependency(source, deps, 'highway')),
        },
        {
            name: 'simdutf',
            version: within,
            license: 'Apache-2.0 OR MIT',
            texts: licenseTexts(join(source, 'pkg/simdutf/vendor')),
        },
        {
            name: 'uucode',
            version: within,
            license: 'MIT',
            texts: licenseTexts(join(deps, folderStarting(deps, 'uucode-'))),
        },
        {
            name: 'Wuffs',
            version: within,
            license: 'Apache-2.0 OR MIT',
            texts: licenseTexts(zigDependency(source, deps, 'wuffs')),
        },
    ];
}

function fonts(): readonly Notice[] {
    return [
        { name: 'Atkinson Hyperlegible Next', file: 'atkinson-hyperlegible-next.OFL.txt' },
        { name: 'Intel One Mono', file: 'intel-one-mono.OFL.txt' },
    ].map(({ name, file }) => ({
        name,
        version: 'font',
        license: 'OFL-1.1',
        texts: [readFileSync(join(FONTS, file), 'utf8')],
    }));
}

/** The folder of the dependency that `pkg/<name>/build.zig.zon` fetches first, in the extracted deps tarball. */
function zigDependency(source: string, deps: string, name: string): string {
    const zon = readFileSync(join(source, 'pkg', name, 'build.zig.zon'), 'utf8');
    const hash = /\.hash = "([^"]+)"/.exec(zon)?.[1];
    if (hash === undefined) {
        throw new Error(`pkg/${name}/build.zig.zon names no dependency`);
    }
    return join(deps, hash);
}

function folderStarting(folder: string, prefix: string): string {
    const found = readdirSync(folder).find((entry) => entry.startsWith(prefix));
    if (found === undefined) {
        throw new Error(`no ${prefix}* folder in ${folder}`);
    }
    return found;
}

function licenseTexts(folder: string): readonly string[] {
    if (!existsSync(folder)) {
        throw new Error(`${folder} does not exist; run pnpm install and tools/fetch-libghostty.sh`);
    }
    return readdirSync(folder)
        .filter(isLicenseFile)
        .sort()
        .map((file) => readFileSync(join(folder, file), 'utf8'));
}

function capture(command: string, args: readonly string[], cwd: string): string {
    return execFileSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

if (import.meta.main) {
    const text = noticesText();
    if (process.argv.includes('--check')) {
        const current = existsSync(OUTPUT) ? readFileSync(OUTPUT, 'utf8') : '';
        if (current !== text) {
            process.stderr.write('THIRD_PARTY_NOTICES.txt is stale: run pnpm notices\n');
            process.exitCode = 1;
        }
    } else {
        mkdirSync(dirname(OUTPUT), { recursive: true });
        writeFileSync(OUTPUT, text);
    }
}
