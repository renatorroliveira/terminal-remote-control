import { describe, expect, it } from 'vitest';
import { releaseNotes, releaseTitle } from './notes.ts';

describe('releaseNotes: GitHub release notes from Conventional Commit subjects', () => {
    it('groups features, fixes and the rest, and drops release bookkeeping', () => {
        const notes = releaseNotes('0.2.0', [
            'feat(app): add host sections',
            'fix(terminal): size the PTY',
            'docs(readme): describe setup',
            'chore(release): start 0.2.0-dev',
            'feat(daemon)!: drop protocol 1',
        ]);
        expect(notes).toBe(
            [
                '# TRC v0.2.0',
                '',
                '## Features',
                '',
                '- **app:** add host sections',
                '- **daemon:** drop protocol 1 (breaking)',
                '',
                '## Fixes',
                '',
                '- **terminal:** size the PTY',
                '',
                '## Other changes',
                '',
                '- **readme:** describe setup',
                '',
            ].join('\n'),
        );
    });

    it('titles a release with the acronym and the tag', () => {
        expect(releaseTitle('0.2.0')).toBe('TRC v0.2.0');
    });
});
