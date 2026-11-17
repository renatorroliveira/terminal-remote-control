import type { TestSeam } from './test-seam';

/** What decides whether the app has This computer. */
export interface LocalHostSources {
    readonly platform: NodeJS.Platform;
    /** Whether this is a test build (P-14). */
    readonly testBuild: boolean;
    readonly seam: TestSeam;
    /** The TRC home, where the local daemon installs (P-56). */
    readonly home: string;
}

/**
 * Where This computer's daemon installs, or `undefined` when the app has no local host: macOS has one from E4 (PRD
 * §7.4), in the TRC home (P-56). A test build has it only when a test gives its daemon a scratch home, so no other
 * test launch registers a LaunchAgent (P-58).
 */
export function localHostRoot(sources: LocalHostSources): string | undefined {
    if (sources.platform !== 'darwin') {
        return undefined;
    }
    if (sources.testBuild && sources.seam.localHome === undefined) {
        return undefined;
    }
    return sources.home;
}
