import { type ChildProcessWithoutNullStreams, execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { decodeServerMessage, encodeClientMessage, FrameDecoder, FrameKind, type ServerMessage } from '@trc/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { type BootstrapOptions, type BootstrapOutcome, type BootstrapStep, runBootstrap } from './driver';
import { LineReader } from './line-reader';
import { parseBootstrapLine } from './lines';
import { parseDaemonManifest } from './manifest';
import { buildBootstrapScript } from './script';

const repository = resolve(import.meta.dirname, '../../../../..');
const run = join(repository, 'tools/test-hosts/.run');
const daemons = join(repository, 'apps/desktop/resources/daemon');
const template = readFileSync(join(repository, 'apps/desktop/resources/bin/bootstrap.sh'), 'utf8');
const manifest = parseDaemonManifest(readFileSync(join(daemons, 'manifest.json'), 'utf8'));

interface Opened {
    readonly child: ChildProcessWithoutNullStreams;
    readonly input: ChildProcessWithoutNullStreams['stdin'];
    readonly output: ChildProcessWithoutNullStreams['stdout'];
}

interface Bootstrapped {
    readonly outcome: BootstrapOutcome;
    readonly steps: readonly BootstrapStep[];
    readonly channel: Opened;
}

const cleanups: (() => void)[] = [];

afterEach(() => {
    for (const cleanup of cleanups.splice(0)) {
        cleanup();
    }
});

function sshArguments(alias: string, command: string): string[] {
    return [
        '-F',
        join(run, 'ssh_config'),
        '-T',
        '-o',
        'BatchMode=yes',
        '-o',
        'StrictHostKeyChecking=yes',
        '-o',
        `UserKnownHostsFile=${join(run, 'known_hosts.smoke')}`,
        alias,
        command,
    ];
}

function open(alias: string): Opened {
    const child = spawn('ssh', sshArguments(alias, 'exec /bin/sh -s'));
    cleanups.push(() => child.kill());
    return { child, input: child.stdin, output: child.stdout };
}

function remote(alias: string, command: string): string {
    return execFileSync('ssh', sshArguments(alias, command), { encoding: 'utf8' });
}

function exists(alias: string, path: string): boolean {
    return remote(alias, `test -e "${path}" && echo yes || echo no`).trim() === 'yes';
}

function freshRoot(alias: string, base = '$HOME'): string {
    const root = `${base}/.trct-${randomBytes(4).toString('hex')}`;
    cleanups.push(() => remote(alias, `kill $(cat "${root}/run/core.lock" 2>/dev/null) 2>/dev/null; rm -rf "${root}"`));
    return root;
}

async function bootstrap(
    alias: string,
    root: string,
    overrides: Partial<BootstrapOptions> = {},
): Promise<Bootstrapped> {
    const channel = open(alias);
    const nonce = randomBytes(8).toString('hex');
    const steps: BootstrapStep[] = [];
    const outcome = await runBootstrap(channel, {
        script: buildBootstrapScript(template, { nonce, root: root.replace('$HOME', '~') }),
        nonce,
        manifest,
        readBinary: async (platform) => readFile(join(daemons, platform, 'trcd')),
        onStep: (step) => steps.push(step),
        ...overrides,
    });
    return { outcome, steps, channel };
}

async function handshake(bootstrapped: Bootstrapped): Promise<ServerMessage> {
    expect(bootstrapped.outcome.kind).toBe('running');
    const { channel } = bootstrapped;
    const decoder = new FrameDecoder();
    const remainder = bootstrapped.outcome.kind === 'running' ? bootstrapped.outcome.remainder : new Uint8Array();
    channel.input.write(encodeClientMessage({ type: 'hello', minProto: 1, maxProto: 1, appVersion: 'test', caps: [] }));
    const frames = [...decoder.push(remainder)];
    channel.output.resume();
    for await (const chunk of channel.output) {
        frames.push(...decoder.push(chunk as Buffer));
        const control = frames.find((frame) => frame.kind === FrameKind.Control);
        if (control !== undefined) {
            const decoded = decodeServerMessage(control.payload);
            if (!decoded.ok) {
                throw new Error(decoded.error);
            }
            return decoded.message;
        }
    }
    throw new Error('the bridge closed before answering');
}

describe.each(['trc-ubuntu', 'trc-alpine', 'trc-rocky', 'trc-ubuntu-nss'])('bootstrap on %s', (alias) => {
    it('installs the daemon, runs the bridge, and reuses the install on the next connection', async () => {
        const root = freshRoot(alias);
        const first = await bootstrap(alias, root);
        expect(first.steps).toEqual(['checking', 'uploading', 'verifying', 'starting']);
        const welcome = await handshake(first);
        expect(welcome).toMatchObject({ type: 'welcome', proto: 1, daemonVersion: manifest.version });
        first.channel.child.kill();

        const second = await bootstrap(alias, root);
        expect(second.steps).toEqual(['checking', 'starting']);
        expect(await handshake(second)).toMatchObject({ type: 'welcome' });
    });

    it('leaves nothing behind after a corrupted upload', async () => {
        const root = freshRoot(alias);
        const { outcome } = await bootstrap(alias, root, {
            readBinary: async (platform) => {
                const bytes = await readFile(join(daemons, platform, 'trcd'));
                bytes[bytes.length - 1] = (bytes.at(-1) ?? 0) ^ 0xff;
                return bytes;
            },
        });
        expect(outcome).toEqual({ kind: 'failed', failure: { kind: 'host', code: 'checksum-mismatch', detail: '' } });
        expect(exists(alias, root)).toBe(false);
    });
});

describe('bootstrap failures', () => {
    it('leaves nothing behind when the upload stops short, and keeps directories it did not create', async () => {
        const parent = freshRoot('trc-alpine');
        remote('trc-alpine', `mkdir -p "${parent}"`);
        const root = `${parent}/trc`;
        const channel = open('trc-alpine');
        const nonce = randomBytes(8).toString('hex');
        const reader = new LineReader(channel.output);
        const sha = manifest.binaries['linux-arm64']?.sha256 ?? '';
        channel.input.write(buildBootstrapScript(template, { nonce, root: root.replace('$HOME', '~') }));
        await nextLine(reader, nonce, 'hello');
        channel.input.end(`UPLOAD 4096 ${sha} ${manifest.version}\n${'x'.repeat(100)}`);
        const error = await nextLine(reader, nonce, 'error');
        expect(error).toMatchObject({ kind: 'error', code: 'short-upload', detail: 'received 100 of 4096 bytes' });
        await new Promise((done) => channel.child.on('exit', done));
        expect(exists('trc-alpine', root)).toBe(false);
        expect(exists('trc-alpine', parent)).toBe(true);
    });
});

describe('bootstrap over an existing install', () => {
    it('ignores version directories that hold no working daemon', async () => {
        const root = freshRoot('trc-ubuntu');
        const silent = `${root}/versions/${'a'.repeat(64)}`;
        const foreign = `${root}/versions/${'b'.repeat(64)}`;
        remote(
            'trc-ubuntu',
            `umask 077 && mkdir -p "${silent}" "${foreign}" && printf '#!/bin/sh\\n' > "${silent}/trcd" && ` +
                `printf '#!/bin/sh\\necho other 1.0\\n' > "${foreign}/trcd" && chmod 700 "${silent}/trcd" "${foreign}/trcd"`,
        );
        const { outcome, steps } = await bootstrap('trc-ubuntu', root);
        expect(outcome.kind).toBe('running');
        expect(steps).toEqual(['checking', 'uploading', 'verifying', 'starting']);
    });

    it('replaces an installed daemon whose binary no longer matches its checksum (SEC-04.3)', async () => {
        const root = freshRoot('trc-ubuntu');
        const sha = manifest.binaries['linux-arm64']?.sha256 ?? '';
        remote(
            'trc-ubuntu',
            `umask 077 && mkdir -p "${root}/versions/${sha}" && printf '#!/bin/sh\\necho trcd 9.9.9 ${sha}\\n' > ` +
                `"${root}/versions/${sha}/trcd" && chmod 700 "${root}/versions/${sha}/trcd"`,
        );
        const bootstrapped = await bootstrap('trc-ubuntu', root);
        expect(bootstrapped.steps).toEqual(['checking', 'uploading', 'verifying', 'starting']);
        expect(await handshake(bootstrapped)).toMatchObject({ type: 'welcome', daemonVersion: manifest.version });
    });
});

describe('bootstrap install locations', () => {
    it('names a noexec home and installs in a per-host location instead (US-1.4.3, R10)', async () => {
        const home = freshRoot('trc-noexec');
        const refused = await bootstrap('trc-noexec', home);
        expect(refused.outcome).toMatchObject({ kind: 'failed', failure: { kind: 'host', code: 'noexec' } });
        expect(exists('trc-noexec', home)).toBe(false);

        const elsewhere = freshRoot('trc-noexec', '/var/tmp');
        const accepted = await bootstrap('trc-noexec', elsewhere);
        expect(await handshake(accepted)).toMatchObject({ type: 'welcome' });
    });

    it('refuses an install location others can write', async () => {
        const root = freshRoot('trc-rocky');
        remote('trc-rocky', `mkdir -p "${root}" && chmod 0777 "${root}"`);
        const { outcome } = await bootstrap('trc-rocky', root);
        expect(outcome).toMatchObject({ kind: 'failed', failure: { kind: 'host', code: 'root-unusable' } });
    });
});

async function nextLine(reader: LineReader, nonce: string, kind: string) {
    for (;;) {
        const text = await reader.next();
        if (text === undefined) {
            throw new Error(`the channel closed before a ${kind} line`);
        }
        const line = parseBootstrapLine(text, nonce);
        if (line?.kind === kind) {
            return line;
        }
    }
}
