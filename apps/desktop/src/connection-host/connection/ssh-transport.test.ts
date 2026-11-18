import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAppLogger } from '../logging/app-log';
import type { ConnectionRuntime } from './host-connection';
import { SshTransport } from './ssh-transport';

function runtime(home: string): ConnectionRuntime {
    return {
        ssh: '/usr/bin/ssh',
        helpers: { askpass: '/x/askpass', knownHosts: '/x/known-hosts' },
        seam: undefined,
        env: { HOME: home },
        runDir: join(home, 'run'),
        appVersion: '0.5.0',
        bootstrapTemplate: '',
        manifest: { version: '0.5.0', binaries: {} },
        readBinary: () => Promise.reject(new Error('none')),
        log: createAppLogger(join(home, 'logs')),
    };
}

describe('SshTransport (US-1.2.2)', () => {
    it('records no host key before ssh has said which known_hosts file it reads', async () => {
        const home = mkdtempSync(join(tmpdir(), 'trc-ssh-transport-'));
        const transport = new SshTransport(runtime(home), { destination: 'devbox-1', installRoot: '~/.trc' }, () => {});
        const key = { host: 'devbox-1', type: 'ssh-ed25519', key: 'AAAA', fingerprint: 'SHA256:x' };
        expect(await transport.acceptHostKey(key)).toBe(false);
        expect(existsSync(join(home, '.ssh/known_hosts'))).toBe(false);
    });
});
