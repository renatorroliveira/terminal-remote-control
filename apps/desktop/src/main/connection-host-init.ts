import type { ConnectionHostInit } from '../shared/connection-port';
import type { TestSeam } from './test-seam';

/** What the init message is built from. */
export interface InitSources {
    readonly userData: string;
    readonly resources: string;
    readonly appVersion: string;
    /** The test seam (P-14); empty in release builds. */
    readonly seam: TestSeam;
}

/** The connection host's init message; test builds add the P-14 seam when both of its SSH files are set. */
export function connectionHostInit(sources: InitSources): ConnectionHostInit {
    const init: ConnectionHostInit = {
        type: 'init',
        userData: sources.userData,
        resources: sources.resources,
        appVersion: sources.appVersion,
    };
    const { sshConfig, knownHosts } = sources.seam;
    if (sshConfig === undefined || knownHosts === undefined) {
        return init;
    }
    return { ...init, seam: { sshConfig, knownHosts } };
}
