import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LinkService } from './link-service';

function service(contents?: string) {
    const home = mkdtempSync(join(tmpdir(), 'trc-links-'));
    if (contents !== undefined) {
        writeFileSync(join(home, 'accept_urls.json'), contents);
    }
    const opened: string[] = [];
    const links = new LinkService(home, async (url) => {
        opened.push(url);
    });
    return { home, links, opened };
}

describe('LinkService: opening links from the terminal (US-1.12.3, US-1.12.4, SEC-06.2)', () => {
    it('reports a link as untrusted with the origin it may trust, and opens it once confirmed', async () => {
        const { links, opened } = service();
        expect(await links.check('https://google.com/search?q=trc')).toEqual({
            target: 'https://google.com/search?q=trc',
            origin: 'https://google.com',
            trusted: false,
        });
        await links.open('https://google.com/search?q=trc', false);
        expect(opened).toEqual(['https://google.com/search?q=trc']);
    });

    it('keeps a trusted origin in accept_urls.json, readable only by the user, and trusts its links after', async () => {
        const { home, links, opened } = service();
        await links.open('https://google.com/a', true);
        expect(JSON.parse(readFileSync(join(home, 'accept_urls.json'), 'utf8'))).toEqual(['https://google.com']);
        expect(statSync(join(home, 'accept_urls.json')).mode & 0o777).toBe(0o600);
        expect((await links.check('https://google.com/b'))?.trusted).toBe(true);
        expect((await links.check('https://google.com.evil.example/b'))?.trusted).toBe(false);
        await links.open('https://google.com/b', true);
        expect(JSON.parse(readFileSync(join(home, 'accept_urls.json'), 'utf8'))).toEqual(['https://google.com']);
        expect(opened).toEqual(['https://google.com/a', 'https://google.com/b']);
    });

    it('trusts prefixes the user wrote in the file, and ignores entries it cannot use', async () => {
        const { links } = service(JSON.stringify(['https://github.com/trc/', 42, 'ssh://build']));
        expect((await links.check('https://github.com/trc/issues'))?.trusted).toBe(true);
        expect((await links.check('ssh://build/home'))?.trusted).toBe(true);
        expect((await links.check('https://github.com/other'))?.trusted).toBe(false);
    });

    it('treats an unreadable file as no trusted prefixes', async () => {
        const { links } = service('{ not json');
        expect((await links.check('https://google.com'))?.trusted).toBe(false);
    });

    it('refuses targets it must never open, and never trusts a link without a host', async () => {
        const { home, links, opened } = service();
        expect(await links.check('javascript:alert(1)')).toBeUndefined();
        await links.open('javascript:alert(1)', true);
        await links.open('mailto:dev@example.com', true);
        expect(opened).toEqual(['mailto:dev@example.com']);
        expect(() => readFileSync(join(home, 'accept_urls.json'))).toThrow();
    });
});
