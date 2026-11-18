import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { ServerMessage } from '@trc/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConnectionState } from '../../shared/connection';
import { parseDaemonManifest } from '../bootstrap/manifest';
import { createAppLogger } from '../logging/app-log';
import { type ConnectionRuntime, HostConnection } from './host-connection';

const repository = resolve(import.meta.dirname, '../../../../..');
const resources = join(repository, 'apps/desktop/resources');
const manifestFile = join(resources, 'daemon/manifest.json');
const uid = process.getuid?.() ?? 0;
const guiSession = process.platform === 'darwin' && spawnSync('launchctl', ['print', `gui/${uid}`]).status === 0;
const ready = process.platform === 'darwin' && existsSync(join(resources, 'daemon/darwin-universal/trcd'));
const bases: string[] = [];
const logs = mkdtempSync(join(tmpdir(), 'trc-local-logs-'));

afterEach(() => {
    for (const base of bases.splice(0)) {
        const label = agentLabel(join(base, 'root'));
        spawnSync('launchctl', ['bootout', `gui/${uid}/${label}`]);
        spawnSync('pkill', ['-KILL', '-f', join(realpathSync(base), 'root/versions/')]);
        rmSync(base, { recursive: true, force: true });
    }
});

/**
 * The LaunchAgent label the daemon gives an install root: its real path's SHA-256, first 8 hex digits (P-60); its
 * parent's real path and its name once the root is gone.
 */
function agentLabel(root: string): string {
    const real = existsSync(root) ? realpathSync(root) : join(realpathSync(dirname(root)), basename(root));
    return `dev.trc.trcd-${createHash('sha256').update(real).digest('hex').slice(0, 8)}`;
}

function runtime(home: string): ConnectionRuntime {
    return {
        ssh: '/usr/bin/ssh',
        helpers: { askpass: join(resources, 'bin/askpass'), knownHosts: join(resources, 'bin/known-hosts') },
        seam: undefined,
        env: process.env,
        runDir: join(home, 'run'),
        appVersion: '0.5.0',
        bootstrapTemplate: readFileSync(join(resources, 'bin/bootstrap.sh'), 'utf8'),
        manifest: parseDaemonManifest(readFileSync(manifestFile, 'utf8')),
        readBinary: async (platform) => readFile(join(resources, 'daemon', platform, 'trcd')),
        log: createAppLogger(logs),
        localHome: home,
    };
}

function isCreated(message: ServerMessage): boolean {
    return message.type === 'created';
}

async function until(condition: () => boolean, timeoutMs = 60_000): Promise<void> {
    const started = Date.now();
    while (!condition()) {
        if (Date.now() - started > timeoutMs) {
            throw new Error('timed out');
        }
        await new Promise((done) => setTimeout(done, 50));
    }
}

describe.skipIf(!ready)('This computer (US-4.1, US-4.2, P-59)', () => {
    it('installs and starts its daemon without SSH, as a LaunchAgent with a GUI login, and removes it', async () => {
        const local = await connectLocal();
        const connected = local.states.at(-1);
        if (connected?.status !== 'connected') {
            throw new Error(JSON.stringify(connected));
        }
        expect(local.states.some((state) => state.status === 'connecting' && state.step === 'uploading')).toBe(true);
        expect(connected.daemon.service?.manager).toBe(guiSession ? 'launchd' : 'detached');
        expect(existsSync(local.plist)).toBe(guiSession);
        local.connection.send({ type: 'create', requestId: 1, spec: { env: {}, size: { cols: 80, rows: 24 } } });
        await until(() => local.messages.some(isCreated));
        expect(await local.connection.removeDaemon(500)).toEqual({ kind: 'removed', kept: [] });
        expect(existsSync(local.plist)).toBe(false);
        expect(spawnSync('launchctl', ['print', `gui/${uid}/${local.label}`]).status).not.toBe(0);
        expect(execFileSync('ps', ['-axo', 'comm='], { encoding: 'utf8' })).not.toContain(local.root);
    });

    it.skipIf(!guiSession)(
        'boots its LaunchAgent out and deletes the plist when the install was deleted by hand',
        async () => {
            const local = await connectLocal();
            expect(existsSync(local.plist)).toBe(true);
            const versions = join(realpathSync(local.root), 'versions/');
            local.connection.close();
            rmSync(local.root, { recursive: true, force: true });
            spawnSync('pkill', ['-KILL', '-f', versions]);
            expect(await local.connection.removeDaemon(500)).toEqual({ kind: 'removed', kept: [] });
            expect(existsSync(local.plist)).toBe(false);
            expect(spawnSync('launchctl', ['print', `gui/${uid}/${local.label}`]).status).not.toBe(0);
        },
    );
});

/** A connection to This computer that came up or failed, its daemon installing in a new scratch root. */
interface LocalConnection {
    readonly connection: HostConnection;
    readonly states: ConnectionState[];
    readonly messages: ServerMessage[];
    readonly root: string;
    /** The LaunchAgent's label and plist for that root. */
    readonly label: string;
    readonly plist: string;
}

/** Connects This computer with a scratch home and install root, and waits until it connected or failed. */
async function connectLocal(): Promise<LocalConnection> {
    const base = mkdtempSync('/tmp/trcl-');
    bases.push(base);
    const home = join(base, 'home');
    mkdirSync(home, { mode: 0o700 });
    const root = join(base, 'root');
    const states: ConnectionState[] = [];
    const messages: ServerMessage[] = [];
    const listener = {
        state: (state: ConnectionState) => states.push(state),
        message: (message: ServerMessage) => messages.push(message),
        output: () => {},
    };
    const target = { destination: 'localhost', installRoot: root, local: true } as const;
    const connection = new HostConnection(runtime(home), 'local', target, listener);
    await connection.connect();
    await until(() => ['connected', 'failed'].includes(states.at(-1)?.status ?? ''));
    const label = agentLabel(root);
    return { connection, states, messages, root, label, plist: join(home, 'Library/LaunchAgents', `${label}.plist`) };
}
