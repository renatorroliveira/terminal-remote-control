import { afterEach, describe, expect, it } from 'vitest';
import { closeLiveHosts, connectLive, type LiveHost, ssh, testHostsMissing, waitFor } from '../nfr/live-host';

/**
 * The Linux service mode on hosts with systemd (US-2.4, US-2.5.1–2, D-44, P-32): how the daemon runs on each kind of
 * host, that every shell survives the daemon's death and restart, and what survives once every connection closed.
 */

const missing = testHostsMissing();
/** systemd stops a user's instance this long after their last login session ends (`UserStopDelaySec`), plus margin. */
const LOGOUT_SETTLE_MS = 16_000;

interface Variant {
    readonly alias: string;
    readonly manager: 'systemd' | 'detached';
    readonly sessionsEndAtLogout: boolean;
}

const VARIANTS: readonly Variant[] = [
    { alias: 'trc-systemd', manager: 'detached', sessionsEndAtLogout: false },
    { alias: 'trc-systemd-linger', manager: 'systemd', sessionsEndAtLogout: false },
    { alias: 'trc-systemd-kill', manager: 'systemd', sessionsEndAtLogout: true },
];

afterEach(() => closeLiveHosts());

/** The shell PIDs of the host's sessions, as the daemon lists them. */
async function shellPids(host: LiveHost): Promise<readonly number[]> {
    const { message } = await host.request({ type: 'listSessions', requestId: 1 }, 'sessions');
    return message.sessions.flatMap((session) => (session.pid === undefined ? [] : [session.pid]));
}

/** Which of `pids` still run on the host. */
function running(alias: string, pids: readonly number[]): readonly number[] {
    const alive = ssh(alias, pids.map((pid) => `kill -0 ${pid} 2>/dev/null && echo ${pid}`).join('; ') + '; true');
    return alive
        .split('\n')
        .map(Number)
        .filter((pid) => pids.includes(pid));
}

function corePid(host: LiveHost): number {
    return Number(ssh(host.alias, `head -n 1 ~/${host.root}/run/core.lock`).trim());
}

async function reconnect(host: LiveHost): Promise<void> {
    const before = host.states.length;
    await host.connection.connect();
    await waitFor(() => host.states.slice(before).some((state) => state.status === 'connected'), 60_000);
}

describe.skipIf(missing !== undefined)('the daemon on hosts with systemd (US-2.4, US-2.5)', () => {
    it.each(VARIANTS)('reports how it runs on $alias', async ({ alias, manager, sessionsEndAtLogout }) => {
        const host = await connectLive(alias);
        const state = host.states.at(-1);
        expect(state?.status === 'connected' ? state.daemon.service : undefined).toEqual({
            manager,
            sessionsEndAtLogout,
        });
    });

    it.each(VARIANTS)(
        'keeps every shell when the daemon is killed on $alias (US-2.5.2)',
        async ({ alias, manager }) => {
            const host = await connectLive(alias);
            await host.session();
            await host.session();
            await host.session();
            const pids = await shellPids(host);
            expect(pids).toHaveLength(3);
            const killed = corePid(host);
            ssh(alias, `kill -9 ${killed}`);
            await waitFor(() => host.states.at(-1)?.status === 'disconnected', 10_000);
            if (manager === 'systemd') {
                await waitFor(() => corePid(host) !== killed, 10_000);
            }
            expect(running(alias, pids)).toEqual(pids);
            await reconnect(host);
            expect(await shellPids(host)).toEqual(pids);
        },
    );

    it.each(VARIANTS.filter((variant) => variant.manager === 'systemd'))(
        'stays a systemd unit when the app reconnects while systemd restarts the killed core on $alias',
        async ({ alias }) => {
            const host = await connectLive(alias);
            await host.session();
            const pids = await shellPids(host);
            const killed = corePid(host);
            ssh(alias, `kill -9 ${killed}`);
            await waitFor(() => host.states.at(-1)?.status === 'disconnected', 10_000);
            await reconnect(host);
            const state = host.states.at(-1);
            expect(state?.status === 'connected' ? state.daemon.service?.manager : undefined).toBe('systemd');
            expect(await shellPids(host)).toEqual(pids);
        },
    );

    it.each(VARIANTS)(
        'keeps sessions after every connection closed on $alias, unless logout ends them (US-2.4.3, US-2.4.4)',
        async ({ alias, sessionsEndAtLogout }) => {
            const host = await connectLive(alias);
            await host.session();
            const pids = await shellPids(host);
            host.connection.close();
            await new Promise((settled) => setTimeout(settled, LOGOUT_SETTLE_MS));
            expect(running(alias, pids)).toEqual(sessionsEndAtLogout ? [] : pids);
        },
        60_000,
    );
});
