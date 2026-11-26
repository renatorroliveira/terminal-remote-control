import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LinkService } from './link-service';

/** Windows has no POSIX modes; the user profile's ACL keeps these files private there (SEC-02, E6). */
const POSIX_MODES = process.platform !== 'win32';

function service(contents?: string, platform: NodeJS.Platform = 'darwin') {
    const home = mkdtempSync(join(tmpdir(), 'trc-links-'));
    if (contents !== undefined) {
        writeFileSync(join(home, 'accept_urls.json'), contents);
    }
    const opened: string[] = [];
    const open = async (url: string): Promise<void> => {
        opened.push(url);
    };
    return { home, links: new LinkService(home, open, platform), opened };
}

describe('LinkService on Windows: no network shares (SEC-06.2, P-106)', () => {
    it('refuses a file link naming a host, which Windows would open over SMB, and opens local files', async () => {
        const { links, opened } = service(undefined, 'win32');
        expect(await links.check('file://fileserver/share/notes.txt')).toBeUndefined();
        await links.open('file://fileserver/share/notes.txt', false);
        expect(await links.check('file:///C:/Users/notes.txt')).toMatchObject({ target: 'file:///C:/Users/notes.txt' });
        expect(await links.check('file://localhost/C:/notes.txt')).toBeDefined();
        await links.open('file:///C:/Users/notes.txt', false);
        expect(opened).toEqual(['file:///C:/Users/notes.txt']);
    });

    it('refuses the spellings of a network share without a host, which Windows opens as UNC paths too', async () => {
        const { links } = service(undefined, 'win32');
        for (const target of [
            'file:////fileserver/share/a.txt',
            'file://///fileserver/share/a.txt',
            'file://localhost//fileserver/share/a.txt',
            'file:///\\\\fileserver\\share\\a.txt',
            'file:///%5C%5Cfileserver%5Cshare/a.txt',
        ]) {
            expect(await links.check(target), target).toBeUndefined();
        }
    });

    it('leaves file links with a host to macOS, where ls --hyperlink names the computer itself', async () => {
        const { links } = service();
        expect(await links.check('file://my-mac/Users/notes.txt')).toBeDefined();
    });
});

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
        if (POSIX_MODES) {
            expect(statSync(join(home, 'accept_urls.json')).mode & 0o777).toBe(0o600);
        }
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
