import { describe, expect, it } from 'vitest';
import { linkOrigin, MAX_LINK_LENGTH, matchesPrefix, normalizeLink } from './links';

describe('normalizeLink: a link target the OS may open (SEC-06, US-1.12.3)', () => {
    it('accepts any scheme the OS might handle, normalized', () => {
        expect(normalizeLink('HTTPS://Example.com/a?b=1#c')).toBe('https://example.com/a?b=1#c');
        expect(normalizeLink('mailto:dev@example.com')).toBe('mailto:dev@example.com');
        expect(normalizeLink('vscode://file/home/dev/notes.md')).toBe('vscode://file/home/dev/notes.md');
        expect(normalizeLink('file:///etc/hosts')).toBe('file:///etc/hosts');
    });

    it('refuses schemes that run script or carry content, and the app’s own', () => {
        for (const target of ['javascript:alert(1)', 'data:text/html,hi', 'blob:x', 'vbscript:x', 'app://trc/x']) {
            expect(normalizeLink(target)).toBeUndefined();
        }
    });

    it('refuses control characters, spaces, text that is not a URL, and overlong targets (SEC-06.4)', () => {
        expect(normalizeLink('https://example.com/\u001b[31m')).toBeUndefined();
        expect(normalizeLink('https://example.com/\u0085')).toBeUndefined();
        expect(normalizeLink('https://example.com/a b')).toBeUndefined();
        expect(normalizeLink('example.com')).toBeUndefined();
        expect(normalizeLink(`https://example.com/${'a'.repeat(MAX_LINK_LENGTH)}`)).toBeUndefined();
    });
});

describe('linkOrigin: the prefix the confirmation offers to trust (US-1.12.4)', () => {
    it('is the scheme and host before the path, without any user name', () => {
        expect(linkOrigin('https://google.com/search?q=trc')).toBe('https://google.com');
        expect(linkOrigin('https://dev:secret@example.com:8443/x')).toBe('https://example.com:8443');
        expect(linkOrigin('vscode://file/home/dev')).toBe('vscode://file');
    });

    it('is absent for a link without a host, so no single click trusts a whole scheme', () => {
        expect(linkOrigin('mailto:dev@example.com')).toBeUndefined();
        expect(linkOrigin('file:///etc/hosts')).toBeUndefined();
    });
});

describe('matchesPrefix: links that open without asking (US-1.12.4)', () => {
    it('matches the prefix itself and everything under it', () => {
        expect(matchesPrefix('https://google.com', 'https://google.com')).toBe(true);
        expect(matchesPrefix('https://google.com/search?q=1', 'https://google.com')).toBe(true);
        expect(matchesPrefix('https://google.com?q=1', 'https://google.com')).toBe(true);
        expect(matchesPrefix('https://google.com#top', 'https://google.com')).toBe(true);
        expect(matchesPrefix('https://github.com/trc/issues', 'https://github.com/trc/')).toBe(true);
    });

    it('does not match a longer host, another port, or a user name that hides another host', () => {
        expect(matchesPrefix('https://google.com.evil.example/x', 'https://google.com')).toBe(false);
        expect(matchesPrefix('https://google.com:8080/x', 'https://google.com')).toBe(false);
        expect(matchesPrefix('https://google.com@evil.example/x', 'https://google.com')).toBe(false);
        expect(matchesPrefix('http://google.com/x', 'https://google.com')).toBe(false);
    });

    it('matches a hand-written prefix in any letter case for the scheme and host', () => {
        expect(matchesPrefix('https://google.com/x', 'HTTPS://Google.com')).toBe(true);
    });
});
