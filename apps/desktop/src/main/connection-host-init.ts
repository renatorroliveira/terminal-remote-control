import type { ConnectionHostInit } from '../shared/connection-port';

/** What the init message is built from. */
export interface InitSources {
    readonly userData: string;
    readonly resources: string;
    readonly appVersion: string;
    readonly env: Readonly<Record<string, string | undefined>>;
    /** Whether this is a test build; release builds compile the seam out (P-14). */
    readonly seamEnabled: boolean;
}

/** The connection host's init message; test builds add the P-14 seam when both variables are set. */
export function connectionHostInit(sources: InitSources): ConnectionHostInit {
    const init: ConnectionHostInit = {
        type: 'init',
        userData: sources.userData,
        resources: sources.resources,
        appVersion: sources.appVersion,
    };
    const sshConfig = sources.env['TRC_TEST_SSH_CONFIG'];
    const knownHosts = sources.env['TRC_TEST_KNOWN_HOSTS'];
    if (!sources.seamEnabled || sshConfig === undefined || knownHosts === undefined) {
        return init;
    }
    return { ...init, seam: { sshConfig, knownHosts } };
}
