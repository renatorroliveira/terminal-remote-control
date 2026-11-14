import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { BootstrapStep } from './driver';
import { runBootstrap } from './driver';
import type { DaemonManifest } from './manifest';

const sha = 'f'.repeat(64);
const manifest: DaemonManifest = { version: '0.1.0', binaries: { 'linux-arm64': { sha256: sha, size: 5 } } };
const nonce = 'abc123';

interface FakeHost {
    readonly input: PassThrough;
    readonly output: PassThrough;
    readonly received: () => string;
}

function fakeHost(): FakeHost {
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    input.on('data', (chunk: Buffer) => chunks.push(chunk));
    return { input, output, received: () => Buffer.concat(chunks).toString('latin1') };
}

function say(host: FakeHost, line: string): void {
    host.output.write(`${nonce} ${line}\n`);
}

async function until(condition: () => boolean): Promise<void> {
    while (!condition()) {
        await new Promise((resolve) => setTimeout(resolve, 1));
    }
}

function options(steps: BootstrapStep[]) {
    return {
        script: 'SCRIPT\n',
        nonce,
        manifest,
        readBinary: async () => new Uint8Array([1, 2, 3, 4, 5]),
        onStep: (step: BootstrapStep) => steps.push(step),
    };
}

describe('runBootstrap', () => {
    it('installs, then runs the bridge and hands over the bytes after RUNNING', async () => {
        const host = fakeHost();
        const steps: BootstrapStep[] = [];
        const outcome = runBootstrap(host, options(steps));
        await until(() => host.received().includes('SCRIPT\n'));
        host.output.write('noise from .bashrc\n');
        expect(host.received()).toBe('SCRIPT\n');
        expect(steps).toEqual([]);
        say(host, 'HELLO os=Linux arch=arm64 checksum=sha256sum installed=-');
        await until(() => host.received().length >= 'SCRIPT\n'.length + 5);
        expect(host.received()).toBe(`SCRIPT\nUPLOAD 5 ${sha} 0.1.0\n\u0001\u0002\u0003\u0004\u0005`);
        say(host, 'PROGRESS receiving');
        say(host, 'PROGRESS verifying');
        say(host, 'PROGRESS testing');
        say(host, `INSTALLED ${sha} 0.1.0`);
        await until(() => host.received().endsWith(`RUN ${sha}\n`));
        host.output.write(`${nonce} RUNNING\n\u0000\u0000\u0000\u0005`);
        await expect(outcome).resolves.toEqual({
            kind: 'running',
            daemon: { sha256: sha, version: '0.1.0' },
            remainder: new Uint8Array([0, 0, 0, 5]),
        });
        expect(steps).toEqual(['checking', 'uploading', 'verifying', 'starting']);
    });

    it('runs an installed daemon without uploading', async () => {
        const host = fakeHost();
        const steps: BootstrapStep[] = [];
        const outcome = runBootstrap(host, options(steps));
        say(host, `HELLO os=Linux arch=arm64 checksum=sha256sum installed=${sha}:0.1.0`);
        await until(() => host.received().endsWith(`RUN ${sha}\n`));
        say(host, 'RUNNING');
        await expect(outcome).resolves.toMatchObject({ kind: 'running', remainder: new Uint8Array() });
        expect(steps).toEqual(['checking', 'starting']);
        expect(host.received()).not.toContain('UPLOAD');
    });
});

describe('runBootstrap failures', () => {
    it('stops with the plan when the host is unsupported or newer, and tells the script to exit', async () => {
        const host = fakeHost();
        const outcome = runBootstrap(host, options([]));
        say(host, `HELLO os=Linux arch=arm64 checksum=sha256sum installed=${'e'.repeat(64)}:9.0.0`);
        await expect(outcome).resolves.toEqual({
            kind: 'failed',
            failure: { kind: 'plan', plan: { kind: 'update-app', installedVersion: '9.0.0' } },
        });
        expect(host.received().endsWith('EXIT\n')).toBe(true);
    });

    it('reports a host error', async () => {
        const host = fakeHost();
        const outcome = runBootstrap(host, options([]));
        say(host, 'HELLO os=Linux arch=arm64 checksum=sha256sum installed=-');
        say(host, 'ERROR noexec /home/tester/.trc');
        await expect(outcome).resolves.toEqual({
            kind: 'failed',
            failure: { kind: 'host', code: 'noexec', detail: '/home/tester/.trc' },
        });
    });

    it('reports the host error when the host stops reading during an upload', async () => {
        const output = new PassThrough();
        let writes = 0;
        const input = new Writable({
            write(_chunk, _encoding, callback) {
                writes += 1;
                callback(writes > 2 ? Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }) : null);
            },
        });
        const outcome = runBootstrap({ input, output }, options([]));
        output.write(`${nonce} HELLO os=Linux arch=arm64 checksum=sha256sum installed=-\n`);
        output.write(`${nonce} ERROR root-unusable /home/t/.trc is writable by other users\n`);
        await expect(outcome).resolves.toEqual({
            kind: 'failed',
            failure: { kind: 'host', code: 'root-unusable', detail: '/home/t/.trc is writable by other users' },
        });
    });

    it('reports a channel that closes before the bootstrap finishes', async () => {
        const host = fakeHost();
        const outcome = runBootstrap(host, options([]));
        host.output.end('only noise\n');
        await expect(outcome).resolves.toEqual({ kind: 'failed', failure: { kind: 'closed' } });
    });
});

describe('runBootstrap limits (SEC-06, US-1.4.5)', () => {
    it('fails with a protocol error when the host sends a line longer than the reader keeps', async () => {
        const host = fakeHost();
        const outcome = runBootstrap(host, options([]));
        host.output.write(Buffer.alloc(1_100_000, 0x61));
        await expect(outcome).resolves.toEqual({
            kind: 'failed',
            failure: { kind: 'host', code: 'protocol', detail: 'the host sent a line longer than 1 MiB' },
        });
    });

    it('fails when the host stops reading the upload, instead of waiting for the write forever', async () => {
        const output = new PassThrough();
        const input = new Writable({
            write: (chunk: Buffer, _encoding, done) => {
                if (chunk.length !== 5) {
                    done();
                }
            },
        });
        const timing = { helloMs: 1_000, stepMs: 30, uploadBytesPerSecond: 1_000_000 };
        const outcome = runBootstrap({ input, output }, { ...options([]), timing });
        output.write(`${nonce} HELLO os=Linux arch=arm64 checksum=sha256sum installed=-\n`);
        await expect(outcome).resolves.toEqual({ kind: 'failed', failure: { kind: 'silent' } });
    });

    it('fails when the host does not answer in time, even while it keeps sending progress', async () => {
        const silent = fakeHost();
        const timing = { helloMs: 30, stepMs: 30, uploadBytesPerSecond: 1_000_000 };
        await expect(runBootstrap(silent, { ...options([]), timing })).resolves.toEqual({
            kind: 'failed',
            failure: { kind: 'silent' },
        });
        const chatty = fakeHost();
        const outcome = runBootstrap(chatty, { ...options([]), timing });
        say(chatty, 'HELLO os=Linux arch=arm64 checksum=sha256sum installed=-');
        const ticker = setInterval(() => say(chatty, 'PROGRESS receiving'), 5);
        await expect(outcome).resolves.toEqual({ kind: 'failed', failure: { kind: 'silent' } });
        clearInterval(ticker);
    });
});

describe('runBootstrap after an upload (SEC-04.3)', () => {
    it('refuses an install the host reports under another checksum than the one uploaded', async () => {
        const host = fakeHost();
        const outcome = runBootstrap(host, options([]));
        say(host, 'HELLO os=Linux arch=arm64 checksum=sha256sum installed=-');
        await until(() => host.received().length >= 'SCRIPT\n'.length + 5);
        say(host, `INSTALLED ${'e'.repeat(64)} 0.1.0`);
        await expect(outcome).resolves.toEqual({
            kind: 'failed',
            failure: {
                kind: 'host',
                code: 'protocol',
                detail: 'the host installed another daemon than the one uploaded',
            },
        });
        expect(host.received()).not.toContain('RUN ');
    });
});
