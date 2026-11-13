import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCommit, describeCommit } from './build-commit.ts';

describe('buildCommit: the git commit a build comes from, for the About panel', () => {
    it('is the short SHA, marked dirty when the tree has changes', () => {
        expect(describeCommit('3c4d86c', '')).toBe('3c4d86c');
        expect(describeCommit('3c4d86c', ' M package.json')).toBe('3c4d86c-dirty');
    });

    it('reads the repository it runs in, and is unknown outside one', () => {
        expect(buildCommit(resolve(import.meta.dirname, '../..'))).toMatch(/^[0-9a-f]{7,}(-dirty)?$/);
        expect(buildCommit(mkdtempSync(join(tmpdir(), 'trc-no-git-')))).toBe('unknown');
    });
});
