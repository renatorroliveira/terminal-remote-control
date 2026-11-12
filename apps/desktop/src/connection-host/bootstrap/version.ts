const VERSION_PATTERN = /^\d+(\.\d+)*$/;

/**
 * Compares two dotted numeric versions such as `0.10.2`, treating missing parts as 0. Returns `undefined` when
 * either is not such a version, so callers never guess.
 */
export function compareVersions(left: string, right: string): -1 | 0 | 1 | undefined {
    if (!VERSION_PATTERN.test(left) || !VERSION_PATTERN.test(right)) {
        return undefined;
    }
    const leftParts = left.split('.').map(Number);
    const rightParts = right.split('.').map(Number);
    const length = Math.max(leftParts.length, rightParts.length);
    for (let index = 0; index < length; index += 1) {
        const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
        if (difference !== 0) {
            return difference < 0 ? -1 : 1;
        }
    }
    return 0;
}
