import type { ConnectionFailure, PresentedHostKey } from '../../shared/connection';
import type { SshProcess } from './ssh-process';

/** A running process whose standard input and output carry the bootstrap, then the daemon's frames. */
export type Channel = SshProcess;

/** Why a channel ended before the bootstrap finished: a failure, or a host key the user must decide on first. */
export type ClosedChannel = ConnectionFailure | { readonly kind: 'host-key-unknown'; readonly key: PresentedHostKey };

/**
 * How a connection reaches its host's shell: over SSH for a remote host, or with `/bin/sh` for This computer (P-59).
 * The bootstrap, the protocol and everything after them are the same for both.
 */
export interface Transport {
    /** A problem with this computer's tools that stops every connection before it starts, if any. */
    check(): Promise<ConnectionFailure | undefined>;
    /** Starts a channel, or says why it could not. */
    open(): Promise<Channel | { readonly failure: ConnectionFailure }>;
    /** Why `channel` closed during the bootstrap, once it has exited. */
    closed(channel: Channel): Promise<ClosedChannel>;
    /** Records a host key the user accepted, before the connection tries again. */
    acceptHostKey(key: PresentedHostKey): Promise<void>;
    /** Releases what the last `open` made. */
    dispose(): Promise<void>;
}
