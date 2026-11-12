import type { Readable, Writable } from 'node:stream';
import type { InstallPlan } from './install-plan';
import { planInstall } from './install-plan';
import { LineReader } from './line-reader';
import type { BootstrapErrorCode, BootstrapLine, InstalledDaemon } from './lines';
import { parseBootstrapLine } from './lines';
import type { DaemonManifest, DaemonPlatform } from './manifest';

/** A step the app shows and announces while it reaches the daemon (US-1.4.5). */
export type BootstrapStep = 'checking' | 'uploading' | 'verifying' | 'starting';

/** The exec channel running `/bin/sh -s` on the host. */
export interface BootstrapChannel {
    /** The host's standard input. */
    readonly input: Writable;
    /** The host's standard output. */
    readonly output: Readable;
}

/** What the driver needs besides the channel. */
export interface BootstrapOptions {
    /** The script with its parameters, from `buildBootstrapScript`. */
    readonly script: string;
    /** The nonce the script was built with. */
    readonly nonce: string;
    /** The bundled daemons. */
    readonly manifest: DaemonManifest;
    /** Reads a bundled daemon binary. */
    readonly readBinary: (platform: DaemonPlatform) => Promise<Uint8Array>;
    /** Called as each step starts. */
    readonly onStep: (step: BootstrapStep) => void;
}

/** Why the bootstrap stopped. */
export type BootstrapFailure =
    | { readonly kind: 'host'; readonly code: BootstrapErrorCode; readonly detail: string }
    | { readonly kind: 'plan'; readonly plan: InstallPlan }
    | { readonly kind: 'closed' };

/** How the bootstrap ended. */
export type BootstrapOutcome =
    | {
          readonly kind: 'running';
          /** The daemon now running `trcd bridge` on the channel. */
          readonly daemon: InstalledDaemon;
          /** Bytes already read after the `RUNNING` line: the start of the frame stream. */
          readonly remainder: Uint8Array;
      }
    | { readonly kind: 'failed'; readonly failure: BootstrapFailure };

type Next = { readonly line: BootstrapLine } | { readonly failure: BootstrapFailure };

interface Conversation {
    readonly channel: BootstrapChannel;
    readonly reader: LineReader;
    readonly options: BootstrapOptions;
}

/**
 * Runs the bootstrap over an exec channel: sends the script, waits for the host's hello, uploads the bundled daemon
 * when needed and starts `trcd bridge`. On success the channel carries protocol frames from then on.
 */
export async function runBootstrap(channel: BootstrapChannel, options: BootstrapOptions): Promise<BootstrapOutcome> {
    const reader = new LineReader(channel.output);
    const ignoreWriteErrors = (): void => undefined;
    channel.input.on('error', ignoreWriteErrors);
    try {
        options.onStep('checking');
        await send(channel.input, options.script);
        const hello = await next(reader, options.nonce);
        if ('failure' in hello) {
            return failed(hello.failure);
        }
        if (hello.line.kind !== 'hello') {
            return failed(unexpected(hello.line));
        }
        const plan = planInstall(hello.line, options.manifest);
        return await follow({ channel, reader, options }, plan, hello.line.installed);
    } finally {
        reader.release();
        channel.input.off('error', ignoreWriteErrors);
    }
}

async function follow(
    conversation: Conversation,
    plan: InstallPlan,
    installed: readonly InstalledDaemon[],
): Promise<BootstrapOutcome> {
    switch (plan.kind) {
        case 'run': {
            const daemon = installed.find((entry) => entry.sha256 === plan.sha256);
            return start(conversation, daemon ?? { sha256: plan.sha256, version: '' });
        }
        case 'upload': {
            const uploaded = await upload(conversation, plan);
            return 'failure' in uploaded ? failed(uploaded.failure) : start(conversation, uploaded.daemon);
        }
        default:
            await send(conversation.channel.input, 'EXIT\n');
            return failed({ kind: 'plan', plan });
    }
}

async function upload(
    { channel, reader, options }: Conversation,
    plan: Extract<InstallPlan, { kind: 'upload' }>,
): Promise<{ readonly daemon: InstalledDaemon } | { readonly failure: BootstrapFailure }> {
    options.onStep('uploading');
    const bytes = await options.readBinary(plan.platform);
    await send(channel.input, `UPLOAD ${bytes.length} ${plan.binary.sha256} ${plan.version}\n`);
    await send(channel.input, bytes);
    for (;;) {
        const result = await next(reader, options.nonce);
        if ('failure' in result) {
            return result;
        }
        const { line } = result;
        if (line.kind === 'installed') {
            return { daemon: { sha256: line.sha256, version: line.version } };
        }
        if (line.kind === 'progress' && line.step === 'verifying') {
            options.onStep('verifying');
        } else if (line.kind !== 'progress') {
            return { failure: unexpected(line) };
        }
    }
}

async function start({ channel, reader, options }: Conversation, daemon: InstalledDaemon): Promise<BootstrapOutcome> {
    options.onStep('starting');
    await send(channel.input, `RUN ${daemon.sha256}\n`);
    const result = await next(reader, options.nonce);
    if ('failure' in result) {
        return failed(result.failure);
    }
    if (result.line.kind !== 'running') {
        return failed(unexpected(result.line));
    }
    return { kind: 'running', daemon, remainder: reader.release() };
}

async function next(reader: LineReader, nonce: string): Promise<Next> {
    for (;;) {
        const text = await reader.next();
        if (text === undefined) {
            return { failure: { kind: 'closed' } };
        }
        const line = parseBootstrapLine(text, nonce);
        if (line?.kind === 'error') {
            return { failure: { kind: 'host', code: line.code, detail: line.detail } };
        }
        if (line !== undefined) {
            return { line };
        }
    }
}

function unexpected(line: BootstrapLine): BootstrapFailure {
    return { kind: 'host', code: 'protocol', detail: `unexpected ${line.kind} line` };
}

function failed(failure: BootstrapFailure): BootstrapOutcome {
    return { kind: 'failed', failure };
}

/**
 * Writes to the host and resolves once the data is handed over, or as soon as the write fails: the host reports
 * why it stopped reading on its output, which the caller reads next.
 */
function send(stream: Writable, data: string | Uint8Array): Promise<void> {
    return new Promise((resolve) => {
        stream.write(data, () => resolve());
    });
}
