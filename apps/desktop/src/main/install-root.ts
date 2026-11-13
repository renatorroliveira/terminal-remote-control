import { DEFAULT_INSTALL_ROOT } from '../shared/hosts';

/** A test install root: one folder directly under the remote home. */
const TEST_INSTALL_ROOT = /^~\/[\w.-]+$/;

/** What decides where new hosts install the daemon. */
export interface InstallRootSources {
    readonly seamEnabled: boolean;
    readonly env: Readonly<Record<string, string | undefined>>;
}

/**
 * Where new hosts install the daemon: `~/.trc`. Test builds take `TRC_TEST_INSTALL_ROOT` instead, so an e2e run
 * never touches a real install (P-14).
 */
export function installRootFor({ seamEnabled, env }: InstallRootSources): string {
    const test = seamEnabled ? env['TRC_TEST_INSTALL_ROOT'] : undefined;
    return test !== undefined && TEST_INSTALL_ROOT.test(test) ? test : DEFAULT_INSTALL_ROOT;
}
