import { mkdtempSync, writeFileSync } from 'node:fs';
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

describe('KnownHosts: forgetting, install locations and recent hosts (US-1.1.1, US-1.4.3, A11Y-11.9)', () => {
    it('forgets a host but keeps offering its address again, newest first and without repeats', async () => {
        const home = directory();
        const hosts = new KnownHosts(home);
        const first = await hosts.add('devbox-1', '~/.trc');
        await hosts.add('me@build:2222', '~/.trc');
        await hosts.add('devbox-1', '~/.trc');
        expect(await hosts.recent()).toEqual(['devbox-1', 'me@build:2222']);
        await hosts.remove(first.id);
        expect((await new KnownHosts(home).list()).map((host) => host.address.destination)).toEqual(['me@build']);
        expect(await new KnownHosts(home).recent()).toEqual(['devbox-1', 'me@build:2222']);
    });

    it('moves a host’s install location, and refuses one the bootstrap would not accept', async () => {
        const hosts = new KnownHosts(directory());
        const host = await hosts.add('devbox-1', '~/.trc');
        expect(await hosts.setInstallRoot(host.id, '/scratch/me/trc')).toEqual({
            ...host,
            installRoot: '/scratch/me/trc',
        });
        await expect(hosts.setInstallRoot(host.id, 'relative/path')).rejects.toThrow(/install location/);
        await expect(hosts.setInstallRoot('host-0000000000000000', '~/x')).rejects.toThrow(/no host/);
        expect((await hosts.list())[0]?.installRoot).toBe('/scratch/me/trc');
    });

    it('keeps a host’s clipboard-write permission, off unless hosts.json turns it on (SEC-06.1)', async () => {
        const home = directory();
        const host = { id: 'host-0123456789abcdef', address: { destination: 'build' }, installRoot: '~/.trc' };
        writeFileSync(
            join(home, 'hosts.json'),
            JSON.stringify({ hosts: [host, { ...host, id: 'host-fedcba9876543210', allowClipboardWrites: true }] }),
        );
        const hosts = await new KnownHosts(home).list();
        expect(hosts.map((entry) => entry.allowClipboardWrites)).toEqual([undefined, true]);
    });
});
