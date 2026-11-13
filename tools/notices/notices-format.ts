import { dirname } from 'node:path';

/** A shipped third-party package and the folder that holds its license files. */
export interface ShippedPackage {
    readonly name: string;
    readonly version: string;
    readonly license: string;
    readonly folder: string;
}

/** One component in the notices file. */
export interface Notice {
    readonly name: string;
    readonly version: string;
    readonly license: string;
    /** The texts of its license files; empty when the package has none. */
    readonly texts: readonly string[];
}

/** The parts of `cargo metadata --format-version 1` the notices read. */
export interface CargoMetadata {
    readonly packages: readonly {
        readonly id: string;
        readonly name: string;
        readonly version: string;
        readonly license: string | null;
        readonly manifest_path: string;
        readonly source: string | null;
    }[];
    readonly resolve: {
        readonly nodes: readonly {
            readonly id: string;
            readonly deps: readonly {
                readonly pkg: string;
                readonly dep_kinds: readonly { readonly kind: string | null }[];
            }[];
        }[];
    };
}

interface PnpmLicense {
    readonly name: string;
    readonly versions: readonly string[];
    readonly paths: readonly string[];
    readonly license: string;
}

const RULE = '='.repeat(80);
const LICENSE_FILE = /^(licen[cs]e|copying|notice)([-._].*)?$/i;
const OWN_SCOPE = '@trc/';
const OFL_SUFFIX = '.OFL.txt';
const FONT_FILE = /\.(ttf|otf|woff2?)$/;

/**
 * The production npm packages in `pnpm licenses list --prod --json`, one per version, without the app's own. Each
 * version is paired with the folder whose `package.json` holds it (`versionAt`), since pnpm does not promise that
 * its versions and paths line up.
 */
export function npmPackages(
    licensesJson: string,
    versionAt: (folder: string) => string | undefined,
): readonly ShippedPackage[] {
    const groups = Object.values(JSON.parse(licensesJson) as Record<string, readonly PnpmLicense[]>);
    const shipped = groups
        .flat()
        .filter((entry) => !entry.name.startsWith(OWN_SCOPE))
        .flatMap((entry) => entry.paths.map((folder) => installed(entry, folder, versionAt(folder))));
    return byName([...new Map(shipped.map((entry) => [`${entry.name}@${entry.version}`, entry])).values()]);
}

/** The MIT license with `holder`'s copyright, for a package that declares MIT but ships no license file. */
export function mitLicense(holder: string): string {
    return [
        'MIT License',
        '',
        `Copyright (c) ${holder}`,
        '',
        'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated',
        'documentation files (the "Software"), to deal in the Software without restriction, including without limitation',
        'the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and',
        'to permit persons to whom the Software is furnished to do so, subject to the following conditions:',
        '',
        'The above copyright notice and this permission notice shall be included in all copies or substantial portions',
        'of the Software.',
        '',
        'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO',
        'THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE',
        'AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF',
        'CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS',
        'IN THE SOFTWARE.',
    ].join('\n');
}

/**
 * The OFL license files of the bundled fonts, in name order, from the fonts folder's file names. Every font file must
 * have its family's `<family>.OFL.txt` beside it, so a new font cannot ship without its notice.
 */
export function fontLicenses(files: readonly string[]): readonly string[] {
    const licenses = files.filter((file) => file.endsWith(OFL_SUFFIX)).sort();
    const families = licenses.map((file) => file.slice(0, -OFL_SUFFIX.length));
    for (const font of files.filter((file) => FONT_FILE.test(file))) {
        if (!families.some((family) => font.startsWith(`${family}.`) || font.startsWith(`${family}-`))) {
            throw new Error(`the font ${font} has no ${font.replace(FONT_FILE, '')}${OFL_SUFFIX} beside it`);
        }
    }
    return licenses;
}

/** The registry crates linked into `root`: its normal dependencies, transitively, without build or dev ones. */
export function rustPackages(metadata: CargoMetadata, root: string): readonly ShippedPackage[] {
    const nodes = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
    const rootId = metadata.packages.find((entry) => entry.name === root)?.id ?? root;
    const linked = new Set([rootId]);
    const queue = [rootId];
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        const normal = (nodes.get(id)?.deps ?? []).filter((dep) => dep.dep_kinds.some((kind) => kind.kind === null));
        for (const dep of normal.filter((candidate) => !linked.has(candidate.pkg))) {
            linked.add(dep.pkg);
            queue.push(dep.pkg);
        }
    }
    return byName(
        metadata.packages
            .filter((entry) => linked.has(entry.id) && entry.source !== null)
            .map((entry) => ({
                name: entry.name,
                version: entry.version,
                license: entry.license ?? 'unknown',
                folder: dirname(entry.manifest_path),
            })),
    );
}

/** Whether a file in a package's folder is one of its license texts. */
export function isLicenseFile(name: string): boolean {
    return LICENSE_FILE.test(name);
}

/** The plain-text notices file: a preamble, then every component in name order with its license texts. */
export function formatNotices(product: string, notices: readonly Notice[]): string {
    const sorted = [...notices].sort(
        (a, b) => a.name.localeCompare(b.name, 'en') || a.version.localeCompare(b.version, 'en'),
    );
    const sections = sorted.flatMap((notice) => [
        RULE,
        `${notice.name} ${notice.version}`,
        `License: ${notice.license}`,
        '',
        ...(notice.texts.length === 0
            ? [`The package has no license file; it is licensed under ${notice.license}.`, '']
            : notice.texts.flatMap((text) => [normalized(text), ''])),
    ]);
    return [
        `Third-party notices for ${product}`,
        '',
        `${product} includes the components below. Electron and Chromium`,
        'come with their own notices: LICENSE.electron.txt and LICENSES.chromium.html.',
        '',
        ...sections,
    ].join('\n');
}

function installed(entry: PnpmLicense, folder: string, version: string | undefined): ShippedPackage {
    if (version === undefined || !entry.versions.includes(version)) {
        throw new Error(`${entry.name} in ${folder} is ${version}, not one of ${entry.versions.join(', ')}`);
    }
    return { name: entry.name, version, license: entry.license, folder };
}

function byName(packages: readonly ShippedPackage[]): readonly ShippedPackage[] {
    return [...packages].sort((a, b) => a.name.localeCompare(b.name, 'en') || a.version.localeCompare(b.version, 'en'));
}

function normalized(text: string): string {
    return text
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => line.trimEnd())
        .join('\n')
        .trim();
}
