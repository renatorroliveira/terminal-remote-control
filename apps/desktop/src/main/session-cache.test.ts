import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SessionCache } from '../shared/session-cache';
import { SESSION_CACHE_SCHEMA, SessionCacheFile } from './session-cache';

const HOST = 'host-0123456789abcdef';
const cache: SessionCache = {
    [HOST]: [
        { id: '0123456789abcdef', shell: 'bash', order: 0, state: 'running' },
        { id: 'fedcba9876543210', name: 'logs', title: 'tail -f', shell: 'zsh', order: 1, state: 'exited' },
    ],
};

function home(): string {
    return mkdtempSync(join(tmpdir(), 'trc-sessions-'));
}

describe('SessionCacheFile (P-30, SEC-05.1)', () => {
    it('keeps each host’s sessions in sessions.json, mode 0600, and reads them back', async () => {
        const dir = home();
        await new SessionCacheFile(dir).write(cache);
        const file = join(dir, 'sessions.json');
        expect(statSync(file).mode & 0o777).toBe(0o600);
        expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ hosts: cache });
        expect(await new SessionCacheFile(dir).read()).toEqual(cache);
    });

    it('reads no sessions from a missing, corrupt or invalid file', async () => {
        const dir = home();
        expect(await new SessionCacheFile(dir).read()).toEqual({});
        writeFileSync(join(dir, 'sessions.json'), '{"hosts": {"host-0123456789abcdef": [{"id": "x"}]}}');
        expect(await new SessionCacheFile(dir).read()).toEqual({});
    });

    it('takes only what the list shows: no folder, environment, size or process of a session', () => {
        const session = { id: '0123456789abcdef', shell: 'bash', order: 0, state: 'running' };
        expect(SESSION_CACHE_SCHEMA.safeParse({ [HOST]: [session] }).success).toBe(true);
        for (const extra of [{ cwd: '/home/me' }, { env: { TOKEN: 'x' } }, { pid: 4 }]) {
            expect(SESSION_CACHE_SCHEMA.safeParse({ [HOST]: [{ ...session, ...extra }] }).success).toBe(false);
        }
        expect(SESSION_CACHE_SCHEMA.safeParse({ '../hosts': [session] }).success).toBe(false);
        expect(SESSION_CACHE_SCHEMA.safeParse({ [HOST]: [{ ...session, id: '../x' }] }).success).toBe(false);
        expect(SESSION_CACHE_SCHEMA.safeParse({ [HOST]: [{ ...session, title: 'x'.repeat(2_000) }] }).success).toBe(
            false,
        );
    });

    it('takes at most 10,000 sessions in all', () => {
        expect(SESSION_CACHE_SCHEMA.safeParse(fullHosts(10)).success).toBe(true);
        expect(SESSION_CACHE_SCHEMA.safeParse(fullHosts(11)).success).toBe(false);
    });
});

/** `count` hosts with 1,000 sessions each. */
function fullHosts(count: number): Record<string, readonly unknown[]> {
    const sessions = Array.from({ length: 1_000 }, () => ({
        id: '0123456789abcdef',
        shell: 'bash',
        order: 0,
        state: 'running',
    }));
    const hosts: Record<string, readonly unknown[]> = {};
    for (let index = 0; index < count; index += 1) {
        hosts[`host-${index.toString(16).padStart(16, '0')}`] = sessions;
    }
    return hosts;
}
