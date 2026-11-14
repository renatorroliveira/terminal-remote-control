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
}
