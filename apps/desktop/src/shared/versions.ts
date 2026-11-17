/**
 * Whether version `a` is strictly older than `b`, as the daemon decides whether to replace a core (D-46): their
 * numbers compared in order, trailing zeros ignored, and a pre-release (`0.4.0-dev`) older than its release. A
 * version that cannot be read is never older.
 */
export function isOlderVersion(a: string, b: string): boolean {
    const older = versionKey(a);
    const newer = versionKey(b);
    if (older === undefined || newer === undefined) {
        return false;
    }
    const length = Math.max(older.parts.length, newer.parts.length);
    for (let index = 0; index < length; index += 1) {
        const difference = (older.parts[index] ?? 0) - (newer.parts[index] ?? 0);
        if (difference !== 0) {
            return difference < 0;
        }
    }
    return older.preRelease && !newer.preRelease;
}

interface VersionKey {
    readonly parts: readonly number[];
    readonly preRelease: boolean;
}

function versionKey(version: string): VersionKey | undefined {
    const [numbers = '', ...suffix] = version.split('-');
    const parts = numbers.split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : Number.NaN));
    return parts.some(Number.isNaN) ? undefined : { parts, preRelease: suffix.length > 0 };
}
