import type { ConnectionFailure } from '../../shared/connection';
import { startSsh } from './ssh-process';
import type { Channel, ClosedChannel, Transport } from './transport';

/** The shell that runs the bootstrap on This computer, as `exec /bin/sh -s` runs it over SSH. */
const LOCAL_SHELL = '/bin/sh';
/**
 * The variables the local bootstrap, and so the daemon it starts, gets from the app: those the LaunchAgent's plist
 * keeps (P-60); sessions start with a cleared environment of their own.
 */
const PASSED_VARIABLES = ['HOME', 'USER', 'LOGNAME', 'SHELL', 'PATH'] as const;
/** How many of the shell's last error lines a failure keeps. */
const DETAIL_LINES = 20;

/** How This computer's channel starts: the app's environment, and the home folder its daemon sees. */
export interface LocalLaunch {
    readonly env: Readonly<Record<string, string | undefined>>;
    /** The home folder for the bootstrap and the daemon: the user's, or a scratch one in test builds (P-58). */
    readonly home?: string | undefined;
}

/** The environment the local bootstrap runs with: only {@link PASSED_VARIABLES}, with `HOME` set to `home`. */
export function localEnvironment(launch: LocalLaunch): Readonly<Record<string, string>> {
    const entries = PASSED_VARIABLES.flatMap((name) => {
        const value = name === 'HOME' ? (launch.home ?? launch.env['HOME']) : launch.env[name];
        return value === undefined ? [] : [[name, value] as const];
    });
    return Object.fromEntries(entries);
}

/**
 * This computer's transport (P-59): the bootstrap runs in a local `/bin/sh` that the app starts directly, with no SSH,
 * so the daemon is reached only through its standard input and output and nothing listens (SEC-01).
 */
export class LocalTransport implements Transport {
    readonly #launch: LocalLaunch;

    /** A transport that starts the local shell with `launch`. */
    constructor(launch: LocalLaunch) {
        this.#launch = launch;
    }

    /** Nothing to check: `/bin/sh` is part of macOS. */
    check(): Promise<ConnectionFailure | undefined> {
        return Promise.resolve(undefined);
    }

    /** Starts `/bin/sh -s` in the home folder, reading the bootstrap from its standard input. */
    open(): Promise<Channel> {
        const env = localEnvironment(this.#launch);
        return Promise.resolve(
            startSsh({
                program: LOCAL_SHELL,
                args: ['-s'],
                env,
                nonce: '',
                onHelper: () => undefined,
                cwd: env['HOME'],
            }),
        );
    }

    /** A local shell that ended early names nothing SSH could explain, so its own last error lines are the details. */
    async closed(channel: Channel): Promise<ClosedChannel> {
        await channel.exited;
        const details = channel.stderr.filter((line) => line.trim() !== '').slice(-DETAIL_LINES);
        return { kind: 'other', details: details.join('\n') };
    }

    /** This computer has no host key, so it records none. */
    acceptHostKey(): Promise<boolean> {
        return Promise.resolve(false);
    }

    /** Nothing to release. */
    dispose(): Promise<void> {
        return Promise.resolve();
    }
}
