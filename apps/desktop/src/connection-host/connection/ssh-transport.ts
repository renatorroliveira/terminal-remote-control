import { randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import type { ConnectionFailure, ConnectTarget, PresentedHostKey } from '../../shared/connection';
import { effectiveConfigArguments, sshArguments, sshEnvironment, wrapperConfig } from '../ssh/arguments';
import { classifyFailure, diagnoseAuthentication } from '../ssh/classify';
import { type EffectiveConfig, replacementKnownHostsFiles, supportsKnownHostsCommand } from '../ssh/client-checks';
import type { HelperLine } from '../ssh/helper-lines';
import { appendKnownHost, fingerprintOf, knownHostsLine } from '../ssh/known-hosts';
import { fromSsh } from './failures';
import type { ConnectionRuntime } from './host-connection';
import { startSsh } from './ssh-process';
import { createAuthProbes, expandHome, readEffectiveConfig, readSshVersion } from './ssh-tools';
import type { Channel, ClosedChannel, Transport } from './transport';

const REMOTE_COMMAND = 'exec /bin/sh -s';

/**
 * A remote host's transport: the system OpenSSH client with the user's own configuration, one exec channel running
 * `/bin/sh -s`, and ssh's errors explained when it ends (US-1.2, US-1.3, US-1.5).
 */
export class SshTransport implements Transport {
    readonly #runtime: ConnectionRuntime;
    readonly #target: ConnectTarget;
    readonly #onHelper: (line: HelperLine) => void;
    #config: EffectiveConfig | undefined;
    /** The known_hosts files ssh reads, the first keeping accepted keys; set once ssh said which files it reads. */
    #knownHostsFiles: readonly string[] = [];
    #nonce = '';
    #wrapper: string | undefined;

    /** A transport to `target` that reports the app helpers' lines, such as a security-key notice, to `onHelper`. */
    constructor(runtime: ConnectionRuntime, target: ConnectTarget, onHelper: (line: HelperLine) => void) {
        this.#runtime = runtime;
        this.#target = target;
        this.#onHelper = onHelper;
    }

    /** Whether the system ssh exists and is new enough for the host-key helper (US-1.2). */
    async check(): Promise<ConnectionFailure | undefined> {
        const version = await readSshVersion(this.#runtime.ssh, this.#runtime.env);
        if (version === 'missing' || version === undefined) {
            return { kind: 'ssh-missing', details: '' };
        }
        return supportsKnownHostsCommand(version)
            ? undefined
            : { kind: 'ssh-too-old', version: `${version.major}.${version.minor}`, details: '' };
    }

    /**
     * Reads the host's effective SSH settings and starts ssh with the bootstrap's remote command, reading OpenSSH's
     * default known_hosts files instead when the user's discard every key (US-1.2.1).
     */
    async open(): Promise<Channel | { readonly failure: ConnectionFailure }> {
        const runtime = this.#runtime;
        const wrapper = await this.#writeWrapper();
        const config = await readEffectiveConfig(
            runtime.ssh,
            effectiveConfigArguments(wrapper, this.#target),
            runtime.env,
        );
        if (config === undefined) {
            return { failure: { kind: 'other', details: 'ssh could not read the SSH configuration for this host' } };
        }
        const replacement = replacementKnownHostsFiles(config.knownHostsFiles);
        this.#config = config;
        this.#knownHostsFiles = replacement ?? config.knownHostsFiles;
        this.#nonce = randomBytes(8).toString('hex');
        return startSsh({
            program: runtime.ssh,
            args: sshArguments({
                wrapper,
                helpers: runtime.helpers,
                target: this.#target,
                command: REMOTE_COMMAND,
                seam: runtime.seam,
                knownHostsFiles: replacement,
                logLevel: runtime.sshLogLevel,
            }),
            env: sshEnvironment(runtime.env, runtime.helpers, this.#nonce),
            nonce: this.#nonce,
            onHelper: this.#onHelper,
        });
    }

    /** What ssh's errors say, with the authentication probes when the host refused every key (US-1.3). */
    async closed(channel: Channel): Promise<ClosedChannel> {
        await channel.exited;
        const config = this.#config;
        if (config === undefined) {
            return { kind: 'other', details: channel.stderr.join('\n') };
        }
        const failure = classifyFailure(channel.stderr, this.#nonce, config);
        if (failure.kind === 'host-key-unknown') {
            return { kind: 'host-key-unknown', key: { ...failure.key, fingerprint: fingerprintOf(failure.key.key) } };
        }
        const probes = createAuthProbes(dirname(this.#runtime.ssh), this.#runtime.env, extname(this.#runtime.ssh));
        const cause = failure.kind === 'authentication' ? await diagnoseAuthentication(config, probes) : undefined;
        return fromSsh(failure, cause);
    }

    /**
     * Appends the key to the first known_hosts file ssh reads, hashed when ssh hashes (US-1.2.2), and returns that file;
     * records nothing before ssh has said which files it reads and whether it hashes.
     */
    async acceptHostKey(key: PresentedHostKey): Promise<string | undefined> {
        const config = this.#config;
        if (config === undefined) {
            return undefined;
        }
        const file = this.#knownHostsFiles[0] ?? '~/.ssh/known_hosts';
        await appendKnownHost(expandHome(file), knownHostsLine(key, { hashed: config.hashKnownHosts }));
        return file;
    }

    /** Deletes the connection's wrapper config. */
    async dispose(): Promise<void> {
        const wrapper = this.#wrapper;
        this.#wrapper = undefined;
        if (wrapper !== undefined) {
            await rm(wrapper, { force: true });
        }
    }

    async #writeWrapper(): Promise<string> {
        await this.dispose();
        await mkdir(this.#runtime.runDir, { recursive: true, mode: 0o700 });
        const file = join(this.#runtime.runDir, `ssh-${randomBytes(8).toString('hex')}.conf`);
        const { helpers, seam, systemSshConfig, sshLogLevel } = this.#runtime;
        const text = wrapperConfig({ helpers, seam, systemConfig: systemSshConfig, logLevel: sshLogLevel });
        await writeFile(file, text, { mode: 0o600 });
        this.#wrapper = file;
        return file;
    }
}
