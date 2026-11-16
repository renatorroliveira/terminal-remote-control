/** The newest protocol version this build speaks. Matches `trc_protocol::PROTOCOL_VERSION`. */
export const PROTOCOL_VERSION = 3;
/** The oldest protocol version this build still speaks: at most N−1 (NFR-12), and 1 so far (P-49). */
export const MIN_PROTOCOL_VERSION = 1;

/** An inclusive range of protocol versions. */
export type VersionRange = readonly [min: number, max: number];

/** Returns the highest version inside both ranges, or `undefined` when they do not overlap (NFR-12). */
export function negotiate(local: VersionRange, remote: VersionRange): number | undefined {
    const highest = Math.min(local[1], remote[1]);
    return highest >= Math.max(local[0], remote[0]) ? highest : undefined;
}
