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

/** The production npm packages in `pnpm licenses list --prod --json`, one per version, without the app's own. */
export function npmPackages(licensesJson: string): readonly ShippedPackage[] {
    const groups = Object.values(JSON.parse(licensesJson) as Record<string, readonly PnpmLicense[]>);
    return byName(
        groups
            .flat()
            .filter((entry) => !entry.name.startsWith(OWN_SCOPE))
            .flatMap((entry) =>
                entry.versions.map((version, index) => ({
                    name: entry.name,
                    version,
                    license: entry.license,
                    folder: entry.paths[index] ?? entry.paths[0] ?? '',
                })),
            ),
    );
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
