import { z } from 'zod';

/** The platforms the app bundles a daemon for: Linux per architecture, and one universal binary for Macs (E4). */
export const DAEMON_PLATFORMS = ['linux-x64', 'linux-arm64', 'darwin-universal'] as const;

/** One bundled daemon platform. */
export type DaemonPlatform = (typeof DAEMON_PLATFORMS)[number];

/** One bundled daemon binary. */
export interface DaemonBinary {
    /** SHA-256 of the binary, in hex. */
    readonly sha256: string;
    /** Size in bytes. */
    readonly size: number;
}

/** `resources/daemon/manifest.json`, written by `pnpm build:daemon` (SEC-04.2). */
export interface DaemonManifest {
    /** The daemon version every bundled binary reports. */
    readonly version: string;
    /** The binaries, by platform. */
    readonly binaries: Readonly<Partial<Record<DaemonPlatform, DaemonBinary>>>;
}

const binarySchema = z.strictObject({
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    size: z.number().int().nonnegative(),
});

const manifestSchema = z.strictObject({
    version: z.string().min(1),
    binaries: z.strictObject({
        'linux-x64': binarySchema.exactOptional(),
        'linux-arm64': binarySchema.exactOptional(),
        'darwin-universal': binarySchema.exactOptional(),
    }),
});

/** Parses and validates a daemon manifest. Throws when it is malformed. */
export function parseDaemonManifest(text: string): DaemonManifest {
    return manifestSchema.parse(JSON.parse(text));
}
