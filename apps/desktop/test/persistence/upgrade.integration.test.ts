import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeLiveHosts, connectLive, type LiveHost, ssh, testHostsMissing, waitFor } from '../nfr/live-host';

/**
 * Upgrading a host's daemon in place (US-2.5.3, D-46): a 0.2.0 daemon with running sessions is replaced by this
 * build's when the app connects, and every session keeps its shell and keeps working; an older bridge never replaces
 * a newer core. The 0.2.0 daemons come from its release (`tools/test-hosts/fetch-old-daemon.sh`).
 */

const OLD_VERSION = '0.2.0';
const oldDaemons = join(process.env.TRC_CACHE_DIR ?? join(homedir(), '.cache/trc'), 'daemon', OLD_VERSION);
const missing =
    testHostsMissing() ??
    (existsSync(join(oldDaemons, 'manifest.json')) ? undefined : 'run tools/test-hosts/fetch-old-daemon.sh');

afterEach(() => closeLiveHosts());

function daemonOf(host: LiveHost): { readonly version: string; readonly proto: number } | undefined {
    const state = host.states.at(-1);
    return state?.status === 'connected' ? state.daemon : undefined;
}

async function shellPids(host: LiveHost): Promise<readonly number[]> {
    const { message } = await host.request({ type: 'listSessions', requestId: 7 }, 'sessions');
    return message.sessions.flatMap((session) => (session.pid === undefined ? [] : [session.pid]));
}

function corePid(alias: string, root: string): string {
    return ssh(alias, `head -n 1 ~/${root}/run/core.lock`).trim();
}

describe.skipIf(missing !== undefined)('upgrading the daemon in place (US-2.5.3)', () => {
    it.each(['trc-ubuntu', 'trc-systemd-linger'])(
        'replaces a 0.2.0 daemon on %s and keeps every session working',
        async (alias) => {
            const root = `.trc-upgrade-${randomBytes(4).toString('hex')}`;
            const old = await connectLive(alias, { daemons: oldDaemons, root });
            expect(daemonOf(old)).toMatchObject({ version: OLD_VERSION, proto: 1 });
            const session = await old.session();
            await old.session();
            const pids = await shellPids(old);
            old.connection.close();
            const upgraded = await connectLive(alias, { root });
            expect(daemonOf(upgraded)?.version).not.toBe(OLD_VERSION);
            expect(daemonOf(upgraded)?.proto).toBe(2);
            expect(await shellPids(upgraded)).toEqual(pids);
            const attach = { type: 'attach', requestId: 8, session: session.id, mode: 'full' } as const;
            const { message } = await upgraded.request(attach, 'attached', (reply) => reply.requestId === 8);
            await waitFor(() => upgraded.tailOf(message.stream).length > 0);
            upgraded.connection.input(message.stream, Buffer.from('echo still-$((20+22))\r'));
            await waitFor(() => upgraded.tailOf(message.stream).includes('still-42'));
        },
        120_000,
    );

    it('never lets an older bridge replace a newer core (US-1.4.6)', async () => {
        const root = `.trc-upgrade-${randomBytes(4).toString('hex')}`;
        const current = await connectLive('trc-ubuntu', { root });
        const pid = corePid('trc-ubuntu', root);
        const old = await connectLive('trc-ubuntu', { daemons: oldDaemons, root });
        expect(daemonOf(old)?.version).toBe(daemonOf(current)?.version);
        expect(corePid('trc-ubuntu', root)).toBe(pid);
    }, 120_000);
});
