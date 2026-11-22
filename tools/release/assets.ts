/** A release file and its SHA-256 digest. */
export interface Digest {
    readonly name: string;
    readonly sha256: string;
}

const ARCHITECTURES = ['arm64', 'x64'] as const;
/** The macOS and the Windows package names after `TRC-<version>-`, per architecture (P-19, P-87). */
const MAC_PACKAGES: readonly ((arch: string) => string)[] = [(arch) => `mac-${arch}.dmg`, (arch) => `mac-${arch}.zip`];
const WINDOWS_PACKAGES: readonly ((arch: string) => string)[] = [
    (arch) => `win-${arch}-setup.exe`,
    (arch) => `win-${arch}.zip`,
];

/**
 * The packages a release ships, in order: the macOS dmg and zip, then the Windows installer and zip, each for arm64
 * and x64 (P-19, P-87). Fails when `files` lacks one, so a release never goes out incomplete.
 */
export function releaseAssets(files: readonly string[], version: string): readonly string[] {
    const named = (packages: readonly ((arch: string) => string)[]): readonly string[] =>
        ARCHITECTURES.flatMap((arch) => packages.map((name) => `TRC-${version}-${name(arch)}`));
    const expected = [...named(MAC_PACKAGES), ...named(WINDOWS_PACKAGES)];
    const missing = expected.filter((name) => !files.includes(name));
    if (missing.length > 0) {
        throw new Error(`missing release packages: ${missing.join(', ')}`);
    }
    return expected;
}

/** The text of `SHA256SUMS.txt`, in the format `shasum -a 256 -c` checks. */
export function sha256Sums(digests: readonly Digest[]): string {
    return digests.map(({ name, sha256 }) => `${sha256}  ${name}\n`).join('');
}
