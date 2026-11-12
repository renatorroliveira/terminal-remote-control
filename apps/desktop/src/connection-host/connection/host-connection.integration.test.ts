import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ServerMessage } from '@trc/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConnectionState, ConnectTarget } from '../../shared/connection';
import { parseDaemonManifest } from '../bootstrap/manifest';
import { createAppLogger } from '../logging/app-log';
import { type ConnectionRuntime, HostConnection } from './host-connection';

const repository = resolve(import.meta.dirname, '../../../../..');
const run = join(repository, 'tools/test-hosts/.run');
const resources = join(repository, 'apps/desktop/resources');
const manifest = parseDaemonManifest(readFileSync(join(resources, 'daemon/manifest.json'), 'utf8'));
const scratch = mkdtempSync(join(tmpdir(), 'trc-conn-'));

const opened: HostConnection[] = [];
const roots: [string, string][] = [];

afterEach(() => {
    for (const connection of opened.splice(0)) {
        connection.close();
    }
    for (const [alias, root] of roots.splice(0)) {
        removeInstall(alias, root);
    }
});

function knownHosts(content: 'trusted' | 'empty' | 'changed'): string {
    const file = join(mkdtempSync(join(scratch, 'kh-')), 'known_hosts');
    if (content === 'trusted') {
        copyFileSync(join(run, 'known_hosts.smoke'), file);
    } else if (content === 'empty') {
        writeFileSync(file, '');
    } else {
        const alpineKey = readFileSync(join(run, 'known_hosts.smoke'), 'utf8')
            .split('\n')
            .find((line) => line.startsWith('[127.0.0.1]:2222'));
        writeFileSync(file, `${alpineKey?.replace('[127.0.0.1]:2222', '[127.0.0.1]:2221')}\n`);
    }
    return file;
}

function runtime(known: string, env: Readonly<Record<string, string | undefined>> = process.env): ConnectionRuntime {
    return {
        ssh: '/usr/bin/ssh',
        helpers: { askpass: join(resources, 'bin/askpass'), knownHosts: join(resources, 'bin/known-hosts') },
        seam: { sshConfig: join(run, 'ssh_config'), knownHosts: known },
        env,
        runDir: mkdtempSync(join(scratch, 'run-')),
        appVersion: '0.1.0',
        bootstrapTemplate: readFileSync(join(resources, 'bin/bootstrap.sh'), 'utf8'),
        manifest,
        readBinary: async (platform) => readFile(join(resources, 'daemon', platform, 'trcd')),
        log: createAppLogger(join(scratch, 'logs')),
    };
}

interface Observed {
    readonly connection: HostConnection;
    readonly states: ConnectionState[];
    readonly messages: ServerMessage[];
    readonly output: Map<number, string>;
}

function open(alias: string, known: string, env?: Readonly<Record<string, string | undefined>>): Observed {
    const root = `.trct-${Math.random().toString(16).slice(2, 10)}`;
    roots.push([alias, root]);
    const target: ConnectTarget = { destination: alias, installRoot: `~/${root}` };
    const states: ConnectionState[] = [];
    const messages: ServerMessage[] = [];
    const output = new Map<number, string>();
    const connection = new HostConnection(runtime(known, env), alias, target, {
        state: (state) => states.push(state),
        message: (message) => messages.push(message),
        output: (stream, data) => output.set(stream, (output.get(stream) ?? '') + Buffer.from(data).toString('utf8')),
    });
    opened.push(connection);
    return { connection, states, messages, output };
}

async function until(condition: () => boolean, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!condition()) {
        if (Date.now() > deadline) {
            throw new Error('timed out waiting');
        }
        await new Promise((done) => setTimeout(done, 20));
    }
}

function last(observed: Observed): ConnectionState | undefined {
    return observed.states.at(-1);
}

async function settled(observed: Observed): Promise<ConnectionState | undefined> {
    await until(() => ['connected', 'failed', 'host-key', 'disconnected'].includes(last(observed)?.status ?? ''));
    return last(observed);
}

async function awaitMessage<T extends ServerMessage['type']>(
    observed: Observed,
    type: T,
): Promise<Extract<ServerMessage, { type: T }>> {
    const isWanted = (message: ServerMessage): message is Extract<ServerMessage, { type: T }> => message.type === type;
    await until(() => observed.messages.some(isWanted));
    const found = observed.messages.find(isWanted);
    if (found === undefined) {
        throw new Error(`no ${type} message`);
    }
    return found;
}

function received(observed: Observed, stream: number): string {
    return observed.output.get(stream) ?? '';
}

describe('HostConnection sessions over real ssh', () => {
    it('installs, connects and runs a session over one channel (US-1.4, US-1.5)', async () => {
        const observed = open('trc-ubuntu', knownHosts('trusted'));
        await observed.connection.connect();
        expect(await settled(observed)).toMatchObject({
            status: 'connected',
            daemon: { version: manifest.version, proto: 1 },
        });
        const steps = observed.states.flatMap((state) => (state.status === 'connecting' ? [state.step] : []));
        expect(steps).toEqual(['connecting', 'checking', 'uploading', 'verifying', 'starting', 'handshake']);
        const { connection } = observed;
        connection.send({ type: 'create', requestId: 1, spec: { env: {}, size: { cols: 80, rows: 24 } } });
        const created = await awaitMessage(observed, 'created');
        connection.send({ type: 'attach', requestId: 2, session: created.session.id, mode: 'full' });
        const { stream } = await awaitMessage(observed, 'attached');
        await until(() => received(observed, stream).length > 0);
        connection.input(stream, Buffer.from('echo trc-$((6*7))\r'));
        await until(() => received(observed, stream).includes('trc-42'));
    });
});

describe('HostConnection host keys (US-1.2)', () => {
    it('asks about an unknown host key and connects once it is accepted (US-1.2.1)', async () => {
        const known = knownHosts('empty');
        const observed = open('trc-alpine', known);
        await observed.connection.connect();
        const asked = await settled(observed);
        expect(asked).toMatchObject({ status: 'host-key', key: { host: '[127.0.0.1]:2222', type: 'ssh-ed25519' } });
        const fingerprint = asked?.status === 'host-key' ? asked.key.fingerprint : '';
        const expected = execFileSync(
            'ssh-keygen',
            ['-l', '-F', '[127.0.0.1]:2222', '-f', join(run, 'known_hosts.smoke')],
            { encoding: 'utf8' },
        );
        expect(expected).toContain(fingerprint);
        await observed.connection.acceptHostKey(fingerprint);
        expect(await settled(observed)).toMatchObject({ status: 'connected' });
        expect(readFileSync(known, 'utf8')).toMatch(/^\[127\.0\.0\.1\]:2222 ssh-ed25519 AAAA/);
    });

    it('asks for the jump host and then the target behind it (D-21)', async () => {
        const observed = open('trc-behind', knownHosts('empty'));
        await observed.connection.connect();
        const jump = await settled(observed);
        expect(jump).toMatchObject({ status: 'host-key', key: { host: '[127.0.0.1]:2225' } });
        await observed.connection.acceptHostKey(jump?.status === 'host-key' ? jump.key.fingerprint : '');
        const target = await settled(observed);
        expect(target).toMatchObject({ status: 'host-key', key: { host: 'behind' } });
        await observed.connection.acceptHostKey(target?.status === 'host-key' ? target.key.fingerprint : '');
        expect(await settled(observed)).toMatchObject({ status: 'connected' });
    });

    it('refuses a changed host key with no way around it (US-1.2.2)', async () => {
        const observed = open('trc-ubuntu', knownHosts('changed'));
        await observed.connection.connect();
        expect(await settled(observed)).toMatchObject({
            status: 'failed',
            failure: { kind: 'host-key-changed', host: '[127.0.0.1]:2221' },
        });
    });
});

describe('HostConnection failures (US-1.3.1)', () => {
    it.each([
        ['trc-rejected', { kind: 'authentication', cause: 'key-rejected' }],
        ['trc-expired', { kind: 'authentication', cause: 'certificate-expired' }],
        ['trc-unreachable', { kind: 'unreachable', host: '127.0.0.1', port: 2299 }],
        ['trc-dns', { kind: 'dns', host: 'no-such-host.invalid' }],
        ['trc-badjump', { kind: 'jump-failed', jump: 'trc-unreachable', cause: 'unreachable' }],
        ['trc-timeout', { kind: 'timeout', host: '10.255.255.1' }],
    ])('explains the failure on %s (US-1.3.1)', async (alias, failure) => {
        const observed = open(alias, knownHosts('trusted'));
        await observed.connection.connect();
        expect(await settled(observed)).toMatchObject({ status: 'failed', failure });
    });

    it('tells a missing agent from an empty one for a passphrase key', async () => {
        const noAgent = open('trc-pass', knownHosts('trusted'), { ...process.env, SSH_AUTH_SOCK: undefined });
        await noAgent.connection.connect();
        expect(await settled(noAgent)).toMatchObject({ failure: { kind: 'authentication', cause: 'no-agent' } });

        const socket = join(mkdtempSync(join(scratch, 'agent-')), 'agent.sock');
        const agent = spawn('ssh-agent', ['-D', '-a', socket], { stdio: 'ignore' });
        try {
            await until(() => agentAnswers(socket));
            const empty = open('trc-pass', knownHosts('trusted'), { ...process.env, SSH_AUTH_SOCK: socket });
            await empty.connection.connect();
            expect(await settled(empty)).toMatchObject({ failure: { kind: 'authentication', cause: 'agent-empty' } });
        } finally {
            agent.kill();
        }
    });
});

describe('HostConnection liveness', () => {
    it('detects a dead connection within 30 s (NFR-07, US-1.5.5)', async () => {
        const observed = open('trc-rocky', knownHosts('trusted'));
        await observed.connection.connect();
        expect(await settled(observed)).toMatchObject({ status: 'connected' });
        const docker = ['--context', 'colima-trc'];
        execFileSync('docker', [...docker, 'pause', 'trc-test-hosts-rocky-1']);
        try {
            const started = Date.now();
            await until(() => last(observed)?.status === 'disconnected', 35_000);
            expect(Date.now() - started).toBeLessThanOrEqual(30_000);
        } finally {
            execFileSync('docker', [...docker, 'unpause', 'trc-test-hosts-rocky-1']);
        }
    }, 60_000);
});

function agentAnswers(socket: string): boolean {
    try {
        execFileSync('ssh-add', ['-l'], { env: { ...process.env, SSH_AUTH_SOCK: socket }, stdio: 'ignore' });
    } catch (error) {
        return (error as { status?: number }).status === 1;
    }
    return false;
}

/** Best-effort removal of a test install; hosts that are unreachable on purpose have nothing to remove. */
function removeInstall(alias: string, root: string): void {
    const known = `UserKnownHostsFile=${join(run, 'known_hosts.smoke')}`;
    const command = `kill $(cat ${root}/run/core.lock 2>/dev/null) 2>/dev/null; rm -rf ${root}`;
    try {
        execFileSync('ssh', ['-F', join(run, 'ssh_config'), '-o', known, '-o', 'ConnectTimeout=3', alias, command], {
            stdio: 'ignore',
        });
    } catch {
        return;
    }
}
