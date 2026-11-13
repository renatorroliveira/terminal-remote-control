import { describe, expect, it } from 'vitest';
import { detectLinks } from './link-detector';

describe('detectLinks: URLs in terminal text (US-1.12.3)', () => {
    it('finds a URL and where it sits in the text, without the punctuation that ends the sentence', () => {
        const target = 'https://example.com/a?b=1';
        const text = `see ${target}. Then`;
        expect(detectLinks(text)).toEqual([
            { start: text.indexOf(target), end: text.indexOf(target) + target.length, target },
        ]);
    });

    it('finds URLs of any scheme, and mail links', () => {
        expect(
            detectLinks('ssh://build:22 vscode://file/x mailto:dev@example.com,').map((link) => link.target),
        ).toEqual(['ssh://build:22', 'vscode://file/x', 'mailto:dev@example.com']);
    });

    it('keeps parentheses the URL opens itself, and drops ones around it', () => {
        expect(detectLinks('(https://en.wikipedia.org/wiki/Rust_(language))').map((link) => link.target)).toEqual([
            'https://en.wikipedia.org/wiki/Rust_(language)',
        ]);
        expect(detectLinks('<https://example.com> "https://example.org"').map((link) => link.target)).toEqual([
            'https://example.com',
            'https://example.org',
        ]);
    });

    it('finds nothing in text without a scheme', () => {
        expect(detectLinks('example.com and /home/dev/notes.md and C: drive')).toEqual([]);
    });
});

describe('detectLinks: untrusted text (SEC-06.4)', () => {
    it('ends a URL at a bidirectional formatting character, so it cannot read as another', () => {
        expect(detectLinks('https://good.example\u202elave/moc.live//:sptth').map((link) => link.target)).toEqual([
            'https://good.example',
        ]);
    });
});
