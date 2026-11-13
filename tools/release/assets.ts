/** A release file and its SHA-256 digest. */
export interface Digest {
    readonly name: string;
    readonly sha256: string;
}

const ARCHITECTURES = ['arm64', 'x64'] as const;
const FORMATS = ['dmg', 'zip'] as const;

/**
 * The packages a release ships, in order: the dmg and zip for arm64 and x64 (P-19). Fails when `files` lacks one, so
 * a release never goes out incomplete.
 */
export function releaseAssets(files: readonly string[], version: string): readonly string[] {
    const expected = ARCHITECTURES.flatMap((arch) => FORMATS.map((format) => `TRC-${version}-mac-${arch}.${format}`));
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
