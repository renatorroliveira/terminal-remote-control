import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionState } from '../../shared/connection';
import { createAppLogger } from '../logging/app-log';
import { appendKnownHost } from '../ssh/known-hosts';
import { type ConnectionRuntime, HostConnection } from './host-connection';
import { SshTransport } from './ssh-transport';

vi.mock('../ssh/known-hosts', async (original) => ({
    ...(await original<typeof import('../ssh/known-hosts')>()),
    appendKnownHost: vi.fn(() => Promise.resolve()),
}));

const HOST_KEY = 'AAAAC3NzaC1lZDI1NTE5AAAAIOeBZqCpE5nAcLCRA2jsRHu2UVxb3hdbZsX8jzbqfz4q';

/**
 * A stand-in for ssh: `-V` and `-G` answer as OpenSSH does for a host whose known_hosts is `/dev/null`, and a
 * connection saves its arguments, reports `HOST_KEY` through the helper's line, and fails the way BatchMode does.
 */
const FAKE_SSH = `#!/bin/sh
case " $* " in
*" -V "*) echo "OpenSSH_9.9p1, LibreSSL 3.3.6" >&2; exit 0 ;;
*" -G "*) printf 'user me\\nhostname vm-1\\nport 22\\nuserknownhostsfile /dev/null\\nhashknownhosts no\\nproxyjump none\\n'; exit 0 ;;
esac
printf '%s\\n' "$@" > "$(dirname "$0")/args"
printf '%s HOSTKEY vm-1 ssh-ed25519 ${HOST_KEY} SHA256:x\\n' "$TRC_SSH_NONCE" >&2
echo "No ED25519 host key is known for vm-1 and you have requested strict checking." >&2
echo "Host key verification failed." >&2
exit 255
`;

const TARGET = { destination: 'vm-1', installRoot: '~/.trc' } as const;

function runtime(home: string, ssh = '/usr/bin/ssh'): ConnectionRuntime {
    return {
        ssh,
        helpers: { askpass: '/x/askpass', knownHosts: '/x/known-hosts' },
        seam: undefined,
        env: { HOME: home, PATH: '/usr/bin:/bin' },
        runDir: join(home, 'run'),
        appVersion: '0.5.0',
        bootstrapTemplate: '',
        manifest: { version: '0.5.0', binaries: {} },
        readBinary: () => Promise.reject(new Error('none')),
        log: createAppLogger(join(home, 'logs')),
    };
}

function fakeSsh(home: string): string {
    const ssh = join(home, 'ssh');
    writeFileSync(ssh, FAKE_SSH);
    chmodSync(ssh, 0o755);
    return ssh;
}

function scratchHome(): string {
    return mkdtempSync(join(tmpdir(), 'trc-ssh-transport-'));
}

afterEach(() => {
    vi.mocked(appendKnownHost).mockClear();
});

describe('SshTransport (US-1.2.2)', () => {
    it('records no host key before ssh has said which known_hosts file it reads', async () => {
        const home = scratchHome();
        const transport = new SshTransport(runtime(home), { destination: 'devbox-1', installRoot: '~/.trc' }, () => {});
        const key = { host: 'devbox-1', type: 'ssh-ed25519', key: 'AAAA', fingerprint: 'SHA256:x' };
        expect(await transport.acceptHostKey(key)).toBeUndefined();
        expect(appendKnownHost).not.toHaveBeenCalled();
        expect(existsSync(join(home, '.ssh/known_hosts'))).toBe(false);
    });

    it("keeps an accepted key in OpenSSH's default file, and has ssh read it, when known_hosts is /dev/null (US-1.2.1)", async () => {
        const home = scratchHome();
        const transport = new SshTransport(runtime(home, fakeSsh(home)), TARGET, () => {});
        const channel = await transport.open();
        if ('failure' in channel) {
            throw new Error(channel.failure.details);
        }
        const closed = await transport.closed(channel);
        if (closed.kind !== 'host-key-unknown') {
            throw new Error(`expected an unknown key, got ${closed.kind}`);
        }
        expect(readFileSync(join(home, 'args'), 'utf8').split('\n')).toContain(
            'UserKnownHostsFile=~/.ssh/known_hosts ~/.ssh/known_hosts2',
        );
        expect(await transport.acceptHostKey(closed.key)).toBe('~/.ssh/known_hosts');
        expect(appendKnownHost).toHaveBeenCalledWith(
            join(homedir(), '.ssh/known_hosts'),
            `vm-1 ssh-ed25519 ${HOST_KEY}`,
        );
        await transport.dispose();
    });
});

describe('HostConnection host-key acceptance (US-1.2.1)', () => {
    it('fails, naming the file, instead of asking again when ssh still does not know the accepted key', async () => {
        const home = scratchHome();
        const states: ConnectionState[] = [];
        const listener = { state: (state: ConnectionState) => states.push(state), message: () => {}, output: () => {} };
        const connection = new HostConnection(runtime(home, fakeSsh(home)), 'host-1', TARGET, listener);
        await connection.connect();
        const asked = connection.state;
        if (asked.status !== 'host-key') {
            throw new Error(`expected a host-key prompt, got ${asked.status}`);
        }
        vi.mocked(appendKnownHost).mockClear();
        await connection.acceptHostKey(asked.key.fingerprint);
        expect(appendKnownHost).toHaveBeenCalledTimes(1);
        expect(connection.state).toEqual({
            status: 'failed',
            failure: { kind: 'host-key-not-kept', host: 'vm-1', file: '~/.ssh/known_hosts', details: '' },
        });
        expect(states.filter((state) => state.status === 'host-key')).toHaveLength(1);
        connection.close();
    });
});
