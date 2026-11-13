import type { HostAddress } from './host-address';

/** A host the user added (US-1.1.1). The app keeps it across restarts in `userData/hosts.json` (P-18). */
export interface KnownHost {
    readonly id: string;
    readonly address: HostAddress;
    /** Where the daemon installs on this host (US-1.4.3). */
    readonly installRoot: string;
}
