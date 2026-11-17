import type { TestSeam } from './test-seam';

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
        ...present('localHome', env['TRC_TEST_LOCAL_HOME']),
    };
}

function present<K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> {
    return value === undefined || value === '' ? {} : ({ [key]: value } as Record<K, string>);
}
