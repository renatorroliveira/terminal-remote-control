import type { HostAddress } from './host-address';

/** Where the daemon installs on every host (US-1.4.3). */
export const DEFAULT_INSTALL_ROOT = '~/.trc';

/** A host the user added (US-1.1.1). The app keeps it across restarts in the TRC home's `hosts.json` (P-18). */
export interface KnownHost {
    readonly id: string;
    readonly address: HostAddress;
    /** Where the daemon installs on this host (US-1.4.3). */
    readonly installRoot: string;
}
