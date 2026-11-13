/** The P-14 test seam's values: what a test build reads from its `TRC_TEST_*` variables. */
export interface TestSeam {
    /** Open behind the focused app, so test runs never take the developer's focus. */
    readonly background: boolean;
    /** An SSH config read ahead of the user's. */
    readonly sshConfig?: string;
    /** A known_hosts file read ahead of the user's. */
    readonly knownHosts?: string;
    /** Where new hosts install the daemon, so a test run never touches a real install. */
    readonly installRoot?: string;
    /** A file that receives opened links, so a test run never opens a browser. */
    readonly openedLinks?: string;
}

/** The seam of a release build: nothing. */
export const NO_TEST_SEAM: TestSeam = { background: false };

/**
 * Reads the seam from the environment. Only test builds call it (`__TRC_TEST_SEAM__ ? readTestSeam(...) : ...`), so
 * release builds drop it, variable names included, and the release-artifact check finds none (P-14).
 */
export function readTestSeam(env: Readonly<Record<string, string | undefined>>): TestSeam {
    return {
        background: env['TRC_TEST_BACKGROUND'] === '1',
        ...present('sshConfig', env['TRC_TEST_SSH_CONFIG']),
        ...present('knownHosts', env['TRC_TEST_KNOWN_HOSTS']),
        ...present('installRoot', env['TRC_TEST_INSTALL_ROOT']),
        ...present('openedLinks', env['TRC_TEST_OPENED_LINKS']),
    };
}

function present<K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> {
    return value === undefined || value === '' ? {} : ({ [key]: value } as Record<K, string>);
}
