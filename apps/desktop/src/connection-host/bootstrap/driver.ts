import type { Readable, Writable } from 'node:stream';
import type { InstallPlan } from './install-plan';
import { planInstall } from './install-plan';
import { LineReader, LineTooLongError } from './line-reader';
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
    /** Called as each step starts: `checking` once the host has answered, so ssh itself has connected. */
    readonly onStep: (step: BootstrapStep) => void;
    /** How long the host may take to answer; {@link BOOTSTRAP_TIMING} when not given. */
    readonly timing?: BootstrapTiming;
}

/** How long the host may take to answer each part of the bootstrap. */
export interface BootstrapTiming {
    /** From sending the script to the host's hello, which includes ssh's own connection and login. */
    readonly helloMs: number;
    /** For any other answer, besides the upload's own transfer time. */
    readonly stepMs: number;
    /** The slowest upload rate allowed for, which bounds the wait for the upload's answer. */
    readonly uploadBytesPerSecond: number;
}

/** The bootstrap's deadlines: generous for slow links, so that only a host that stopped answering fails them. */
export const BOOTSTRAP_TIMING: BootstrapTiming = {
    helloMs: 120_000,
    stepMs: 30_000,
    uploadBytesPerSecond: 16 * 1024,
};

/** Why the bootstrap stopped. */
export type BootstrapFailure =
    | { readonly kind: 'host'; readonly code: BootstrapErrorCode; readonly detail: string }
    | { readonly kind: 'plan'; readonly plan: InstallPlan }
    | { readonly kind: 'closed' }
    | { readonly kind: 'silent' };

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
    readonly timing: BootstrapTiming;
}

const LATE = Symbol('late');

/**
 * Runs the bootstrap over an exec channel: sends the script, waits for the host's hello, uploads the bundled daemon
 * when needed and starts `trcd bridge`. On success the channel carries protocol frames from then on.
 */
export async function runBootstrap(channel: BootstrapChannel, options: BootstrapOptions): Promise<BootstrapOutcome> {
    const reader = new LineReader(channel.output);
    const timing = options.timing ?? BOOTSTRAP_TIMING;
    const ignoreWriteErrors = (): void => undefined;
    channel.input.on('error', ignoreWriteErrors);
    try {
        const deadline = Date.now() + timing.helloMs;
        await send(channel.input, options.script, deadline);
        const hello = await next(reader, options.nonce, deadline);
        if ('failure' in hello) {
            return failed(hello.failure);
        }
        if (hello.line.kind !== 'hello') {
            return failed(unexpected(hello.line));
        }
        options.onStep('checking');
        const plan = planInstall(hello.line, options.manifest);
        return await follow({ channel, reader, options, timing }, plan, hello.line.installed);
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
            await send(conversation.channel.input, 'EXIT\n', Date.now() + conversation.timing.stepMs);
            return failed({ kind: 'plan', plan });
    }
}

async function upload(
    { channel, reader, options, timing }: Conversation,
    plan: Extract<InstallPlan, { kind: 'upload' }>,
): Promise<{ readonly daemon: InstalledDaemon } | { readonly failure: BootstrapFailure }> {
    options.onStep('uploading');
    const bytes = await options.readBinary(plan.platform);
    const deadline = Date.now() + timing.stepMs + (bytes.length / timing.uploadBytesPerSecond) * 1_000;
    await send(channel.input, `UPLOAD ${bytes.length} ${plan.binary.sha256} ${plan.version}\n`, deadline);
    await send(channel.input, bytes, deadline);
    for (;;) {
        const result = await next(reader, options.nonce, deadline);
        const answer = 'failure' in result ? result : uploadAnswer(result.line, plan, options);
        if (answer !== undefined) {
            return answer;
        }
    }
}

/** What a line the host sends during an upload means: the installed daemon, a failure, or `undefined` to read on. */
function uploadAnswer(
    line: BootstrapLine,
    plan: Extract<InstallPlan, { kind: 'upload' }>,
    options: BootstrapOptions,
): { readonly daemon: InstalledDaemon } | { readonly failure: BootstrapFailure } | undefined {
    if (line.kind === 'installed') {
        return line.sha256 === plan.binary.sha256
            ? { daemon: { sha256: plan.binary.sha256, version: line.version } }
            : {
                  failure: {
                      kind: 'host',
                      code: 'protocol',
                      detail: 'the host installed another daemon than the one uploaded',
                  },
              };
    }
    if (line.kind !== 'progress') {
        return { failure: unexpected(line) };
    }
    if (line.step === 'verifying') {
        options.onStep('verifying');
    }
    return undefined;
}

async function start(
    { channel, reader, options, timing }: Conversation,
    daemon: InstalledDaemon,
): Promise<BootstrapOutcome> {
    options.onStep('starting');
    const deadline = Date.now() + timing.stepMs;
    await send(channel.input, `RUN ${daemon.sha256}\n`, deadline);
    const result = await next(reader, options.nonce, deadline);
    if ('failure' in result) {
        return failed(result.failure);
    }
    if (result.line.kind !== 'running') {
        return failed(unexpected(result.line));
    }
    return { kind: 'running', daemon, remainder: reader.release() };
}

async function next(reader: LineReader, nonce: string, deadline: number): Promise<Next> {
    for (;;) {
        const read = await readLine(reader, deadline);
        if ('failure' in read) {
            return read;
        }
        const { text } = read;
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

/** The host's next line, or why there is none: it stopped answering by the deadline, or sent too long a line. */
async function readLine(
    reader: LineReader,
    deadline: number,
): Promise<{ readonly text: string | undefined } | { readonly failure: BootstrapFailure }> {
    try {
        const text = await within(reader.next(), deadline);
        return text === LATE ? { failure: { kind: 'silent' } } : { text };
    } catch (error) {
        if (error instanceof LineTooLongError) {
            return { failure: { kind: 'host', code: 'protocol', detail: error.message } };
        }
        throw error;
    }
}

async function within<T>(work: Promise<T>, deadline: number): Promise<T | typeof LATE> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<typeof LATE>((resolve) => {
        timer = setTimeout(() => resolve(LATE), Math.max(0, deadline - Date.now()));
    });
    work.catch(() => undefined);
    try {
        return await Promise.race([work, late]);
    } finally {
        clearTimeout(timer);
    }
}

function unexpected(line: BootstrapLine): BootstrapFailure {
    return { kind: 'host', code: 'protocol', detail: `unexpected ${line.kind} line` };
}

function failed(failure: BootstrapFailure): BootstrapOutcome {
    return { kind: 'failed', failure };
}

/**
 * Writes to the host and resolves once the data is handed over, as soon as the write fails, or at `deadline` when the
 * host stops reading: the next read then reports why the host stopped, or that it went silent.
 */
async function send(stream: Writable, data: string | Uint8Array, deadline: number): Promise<void> {
    await within(
        new Promise<void>((resolve) => {
            stream.write(data, () => resolve());
        }),
        deadline,
    );
}
