import { DEFAULT_INSTALL_ROOT } from '../shared/hosts';

/** A test install root: one folder directly under the remote home. */
const TEST_INSTALL_ROOT = /^~\/[\w.-]+$/;

/**
 * Where new hosts install the daemon: `~/.trc`. A test build's seam may name another folder directly under the
 * remote home instead, so an e2e run never touches a real install (P-14).
 */
export function installRootFor(testRoot: string | undefined): string {
    return testRoot !== undefined && TEST_INSTALL_ROOT.test(testRoot) ? testRoot : DEFAULT_INSTALL_ROOT;
}
