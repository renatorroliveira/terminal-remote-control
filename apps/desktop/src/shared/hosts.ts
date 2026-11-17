import type { ConnectTarget } from './connection';
import type { HostAddress } from './host-address';

/** Where the daemon installs on a host unless the user moves it (US-1.4.3). */
export const DEFAULT_INSTALL_ROOT = '~/.trc';

/** Whether `root` is an install location the bootstrap accepts: absolute but not `/`, or `~` or under it, on one line. */
export function isInstallRoot(root: string): boolean {
    const anchored = root === '~' || root.startsWith('~/') || root.startsWith('/');
    return anchored && !/^\/+$/.test(root) && root.length <= 4096 && !/[\n\0]/.test(root);
}

/** A host the user added (US-1.1.1). The app keeps it across restarts in the TRC home's `hosts.json` (P-18). */
export interface KnownHost {
    readonly id: string;
    readonly address: HostAddress;
    /** Where the daemon installs on this host (US-1.4.3). */
    readonly installRoot: string;
    /** Whether programs on this host may write the clipboard with OSC 52; off unless set (SEC-06.1). */
    readonly allowClipboardWrites?: boolean;
    /** Whether the user removed its daemon, so the app does not connect it until the user does (US-3.3.3, P-45). */
    readonly daemonRemoved?: boolean;
    /** This computer: reached without SSH, first in the sidebar, never forgotten or moved (US-4.1, US-4.2, P-59). */
    readonly local?: true;
}

/** This computer's host ID (US-4.2.1). */
export const LOCAL_HOST_ID = 'local';

/** Where the connection host reaches a known host: its address and install location, without SSH for This computer. */
export function connectTarget(host: KnownHost): ConnectTarget {
    return { ...host.address, installRoot: host.installRoot, ...(host.local === true ? { local: true } : {}) };
}
