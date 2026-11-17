/** The P-14 test seam's values: what a test build reads from its environment (`test-seam-reader.ts`). */
export interface TestSeam {
    /** Open unseen in the background: transparent, click-through, never focused, so test runs never disturb (D-27). */
    readonly background: boolean;
    /** An SSH config read ahead of the user's. */
    readonly sshConfig?: string;
    /** A known_hosts file read ahead of the user's. */
    readonly knownHosts?: string;
    /** Where new hosts install the daemon, so a test run never touches a real install. */
    readonly installRoot?: string;
    /** A file that receives opened links, so a test run never opens a browser. */
    readonly openedLinks?: string;
    /** The home folder This computer's daemon runs with, so its LaunchAgent plist stays in scratch (P-58). */
    readonly localHome?: string;
}

/** The seam of a release build: nothing. */
export const NO_TEST_SEAM: TestSeam = { background: false };
