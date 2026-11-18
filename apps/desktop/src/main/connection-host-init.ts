import type { ConnectionHostInit } from '../shared/connection-port';
import type { TestSeam } from './test-seam';

/** What the init message is built from. */
export interface InitSources {
    readonly userData: string;
    readonly resources: string;
    readonly appVersion: string;
    /** The test seam (P-14); empty in release builds. */
    readonly seam: TestSeam;
    /** This computer's install location, when the app has This computer (P-56). */
    readonly localRoot?: string | undefined;
}

/**
 * The connection host's init message, with This computer's install location when the app has it; test builds add the
 * P-14 seam when both of its SSH files are set, and the scratch home This computer's daemon runs with (P-58).
 */
export function connectionHostInit(sources: InitSources): ConnectionHostInit {
    const { localHome } = sources.seam;
    const init: ConnectionHostInit = {
        type: 'init',
        userData: sources.userData,
        resources: sources.resources,
        appVersion: sources.appVersion,
        ...(localHome === undefined ? {} : { localHome }),
        ...(sources.localRoot === undefined ? {} : { localRoot: sources.localRoot }),
    };
    const { sshConfig, knownHosts } = sources.seam;
    if (sshConfig === undefined || knownHosts === undefined) {
        return init;
    }
    return { ...init, seam: { sshConfig, knownHosts } };
}
