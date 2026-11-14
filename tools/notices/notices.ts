/**
 * Writes `apps/desktop/resources/notices/THIRD_PARTY_NOTICES.txt`, the licenses of everything the app ships besides
 * Electron and Chromium (ST-20): the production npm packages, the crates linked into the daemon, libghostty-vt and
 * the libraries built into it, and the bundled fonts. `pnpm notices` writes it; `pnpm notices --check` fails while
 * the committed file is stale. Needs `pnpm install`, `cargo` and `tools/fetch-libghostty.sh`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import {
    type CargoMetadata,
    copyrightHolder,
    fontLicenses,
    formatNotices,
    isLicenseFile,
    mitLicense,
    type Notice,
    npmPackages,
    rustPackages,
    type ShippedPackage,
    unnoticedDependencies,
} from './notices-format.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const DESKTOP = join(ROOT, 'apps/desktop');
const OUTPUT = join(DESKTOP, 'resources/notices/THIRD_PARTY_NOTICES.txt');
const FONTS = join(DESKTOP, 'src/renderer/ui/fonts');
const DAEMON_TARGETS = ['x86_64-unknown-linux-musl', 'aarch64-unknown-linux-musl'] as const;
/** The copyright holders of MIT packages that ship no license file and name no author, from their repository. */
const MIT_HOLDERS: Readonly<Record<string, string>> = {
    'client-only': 'Meta Platforms, Inc. and affiliates',
};
/** The folders of libghostty-vt's dependencies that only its build runs, by name prefix: the C translator. */
const BUILD_ONLY_DEPENDENCIES = ['aro-', 'translate_c-'] as const;
const FONT_NAMES: Readonly<Record<string, string>> = {
    'atkinson-hyperlegible-next.OFL.txt': 'Atkinson Hyperlegible Next',
    'intel-one-mono.OFL.txt': 'Intel One Mono',
};

/** The notices file's text, from the packages installed and fetched now. */
export function noticesText(): string {
    const packages = [...npm(), ...rust()];
    const notices: readonly Notice[] = [
        ...packages.map((entry) => ({ ...entry, texts: packageTexts(entry) })),
        ...native(),
        ...fonts(),
    ];
    return `${formatNotices('Terminal Remote Control', notices)}\n`;
}

function npm(): readonly ShippedPackage[] {
    return npmPackages(capture('pnpm', ['licenses', 'list', '--prod', '--json'], DESKTOP), (folder) => {
        const manifest = join(folder, 'package.json');
        return existsSync(manifest)
            ? (JSON.parse(readFileSync(manifest, 'utf8')) as { version?: string }).version
            : undefined;
    });
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
    const highway = zigDependency(source, deps, 'highway');
    const wuffs = zigDependency(source, deps, 'wuffs');
    const uucode = folderStarting(deps, 'uucode-');
    const unnoticed = unnoticedDependencies(
        readdirSync(deps),
        [highway, wuffs, uucode].map((folder) => basename(folder)),
        BUILD_ONLY_DEPENDENCIES,
    );
    if (unnoticed.length > 0) {
        throw new Error(`libghostty-vt ${version} vendors ${unnoticed.join(', ')}; give each a notice in native()`);
    }
    return [
        { name: 'libghostty-vt', version, license: 'MIT', texts: licenseTexts(source) },
        {
            name: 'Highway',
            version: within,
            license: 'Apache-2.0 OR BSD-3-Clause',
            texts: licenseTexts(highway),
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
            texts: licenseTexts(join(deps, uucode)),
        },
        {
            name: 'Wuffs',
            version: within,
            license: 'Apache-2.0 OR MIT',
            texts: licenseTexts(wuffs),
        },
    ];
}

function fonts(): readonly Notice[] {
    return fontLicenses(readdirSync(FONTS)).map((file) => {
        const name = FONT_NAMES[file];
        if (name === undefined) {
            throw new Error(`name the font family of ${file} in FONT_NAMES`);
        }
        return { name, version: 'font', license: 'OFL-1.1', texts: [readFileSync(join(FONTS, file), 'utf8')] };
    });
}

/** A package's license files; for MIT without one, the MIT license with its authors' copyright. */
function packageTexts(entry: ShippedPackage): readonly string[] {
    const texts = licenseTexts(entry.folder);
    return texts.length === 0 && entry.license === 'MIT'
        ? [mitLicense(copyrightHolder(entry.name, holderOf(entry.folder), MIT_HOLDERS))]
        : texts;
}

/** The authors a package's `package.json` or `Cargo.toml` names. */
function holderOf(folder: string): string | undefined {
    const npm = join(folder, 'package.json');
    if (existsSync(npm)) {
        const author = (JSON.parse(readFileSync(npm, 'utf8')) as { author?: string | { name?: string } }).author;
        return typeof author === 'string' ? author : author?.name;
    }
    const cargo = join(folder, 'Cargo.toml');
    const authors = existsSync(cargo)
        ? /^authors\s*=\s*\[([^\]]*)\]/m.exec(readFileSync(cargo, 'utf8'))?.[1]
        : undefined;
    const names = [...(authors ?? '').matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    return names.length === 0 ? undefined : names.join(', ');
}

/** The folder of the dependency named `name` that `pkg/<name>/build.zig.zon` fetches, in the extracted deps tarball. */
function zigDependency(source: string, deps: string, name: string): string {
    const zon = readFileSync(join(source, 'pkg', name, 'build.zig.zon'), 'utf8');
    const hash = new RegExp(`\\.${name} = \\.\\{[^}]*?\\.hash = "([^"]+)"`).exec(zon)?.[1];
    if (hash === undefined) {
        throw new Error(`pkg/${name}/build.zig.zon fetches no dependency named ${name}`);
    }
    return join(deps, hash);
}

function folderStarting(folder: string, prefix: string): string {
    const found = readdirSync(folder)
        .filter((entry) => entry.startsWith(prefix))
        .sort();
    const [only] = found;
    if (found.length !== 1 || only === undefined) {
        throw new Error(`expected one ${prefix}* folder in ${folder}, found ${found.length}`);
    }
    return only;
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
