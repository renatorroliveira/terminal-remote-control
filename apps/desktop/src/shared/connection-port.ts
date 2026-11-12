/** The message the preload posts to the page with the connection host's MessagePort. */
export const CONNECTION_PORT_MESSAGE = 'trc:connection-port';

/** The IPC channel on which the main process sends the port to the preload. */
export const CONNECTION_PORT_CHANNEL = 'trc:connection-port';

/** The first message the main process sends the connection host, with the first renderer port. */
export interface ConnectionHostInit {
    readonly type: 'init';
    /** The app's userData directory, for logs and wrapper configs. */
    readonly userData: string;
    /** The directory holding `bin/` (bootstrap, helpers) and `daemon/` (bundled daemons). */
    readonly resources: string;
    readonly appVersion: string;
    /** The P-14 test seam; only test builds send it. */
    readonly seam?: { readonly sshConfig: string; readonly knownHosts: string };
}

/** The name the connection host's utility process carries in process listings and metrics. */
export const CONNECTION_HOST_NAME = 'Term Remote Control connection host';
