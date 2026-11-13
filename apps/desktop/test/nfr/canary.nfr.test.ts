import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { APP_LOGS, closeLiveHosts, connectLive, ssh, testHostsMissing } from './live-host';
import { record } from './stats';

const missing = testHostsMissing();

afterAll(() => closeLiveHosts());

function filesUnder(folder: string): readonly string[] {
    return readdirSync(folder, { recursive: true, encoding: 'utf8' })
        .map((entry) => join(folder, entry))
        .filter((path) => statSync(path).isFile());
}

describe.skipIf(missing !== undefined)('logs never hold terminal data (SEC-08)', () => {
    it('keeps typed text, output and environment values out of the app and daemon logs', async () => {
        const canary = `trc-canary-${randomBytes(6).toString('hex')}`;
        const host = await connectLive('trc-ubuntu');
        const session = await host.session({ env: { TRC_CANARY: `${canary}-env` } });
        session.type('PS1="trc-ready$ "\r');
        await session.next('trc-ready$ ');
        const done = session.next('TRC-CANARY-DONE');
        session.type(`: ${canary}-typed; echo ${canary}-out; printenv TRC_CANARY; echo TRC-CANARY-""DONE\r`);
        await done;
        host.connection.send({ type: 'rename', requestId: 700_001, session: session.id, name: `${canary}-name` });
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        const appLogs = filesUnder(APP_LOGS);
        const appHits = appLogs.filter((file) => readFileSync(file, 'utf8').includes('trc-canary-'));
        const daemonLogs = ssh(host.alias, `ls ~/${host.root}/logs | wc -l`).trim();
        const daemonHits = ssh(host.alias, `grep -rIl trc-canary- ~/${host.root} 2>/dev/null || true`).trim();
        record({
            id: 'SEC-08',
            what: 'log files holding a typed, printed or environment canary',
            value: appHits.length + (daemonHits === '' ? 0 : daemonHits.split('\n').length),
            unit: 'files',
            target: '0',
        });
        expect(appLogs.length).toBeGreaterThan(0);
        expect(Number(daemonLogs)).toBeGreaterThan(0);
        expect(appHits).toEqual([]);
        expect(daemonHits).toBe('');
    }, 120_000);
});
