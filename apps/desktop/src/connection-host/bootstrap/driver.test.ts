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
        say(host, 'HELLO os=Linux arch=arm64 checksum=sha256sum installed=' + 'e'.repeat(64) + ':9.0.0');
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
