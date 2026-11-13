import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KnownHosts } from './known-hosts';

function directory(): string {
    return mkdtempSync(join(tmpdir(), 'trc-hosts-'));
}

describe('KnownHosts (US-1.1.1, P-18)', () => {
    it('adds hosts in order and keeps them across restarts', async () => {
        const userData = directory();
        const hosts = new KnownHosts(userData);
        const first = await hosts.add('devbox-1', '~/.trc');
        const second = await hosts.add('me@10.0.0.5:2222', '~/.trc');
        expect(first).toMatchObject({ address: { destination: 'devbox-1' }, installRoot: '~/.trc' });
        expect(second.address).toEqual({ destination: 'me@10.0.0.5', port: 2222 });
        expect(first.id).toMatch(/^host-[0-9a-f]{16}$/);
        expect(await new KnownHosts(userData).list()).toEqual([first, second]);
    });

    it('returns the existing host when the same address is added again', async () => {
        const hosts = new KnownHosts(directory());
        const first = await hosts.add('devbox-1', '~/.trc');
        expect(await hosts.add(' devbox-1 ', '~/.trc')).toEqual(first);
        expect(await hosts.list()).toHaveLength(1);
    });

    it('refuses an address ssh could not use', async () => {
        const hosts = new KnownHosts(directory());
        await expect(hosts.add('-oProxyCommand=evil', '~/.trc')).rejects.toThrow(/not a host address/);
        expect(await hosts.list()).toEqual([]);
    });
});
