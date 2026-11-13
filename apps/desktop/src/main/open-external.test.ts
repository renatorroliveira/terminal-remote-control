import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openExternalFor } from './open-external';

describe('openExternalFor: where opened links go', () => {
    it('is the OS in every build without the test seam', async () => {
        const opened: string[] = [];
        const open = openExternalFor({
            seamEnabled: false,
            env: { TRC_TEST_OPENED_LINKS: join(tmpdir(), 'never.log') },
            shellOpen: async (url) => {
                opened.push(url);
            },
        });
        await open('https://example.com');
        expect(opened).toEqual(['https://example.com']);
    });

    it('is a log file in test builds, so an e2e run never opens a browser (P-14)', async () => {
        const log = join(mkdtempSync(join(tmpdir(), 'trc-links-')), 'opened.log');
        const open = openExternalFor({
            seamEnabled: true,
            env: { TRC_TEST_OPENED_LINKS: log },
            shellOpen: () => Promise.reject(new Error('the OS must not be asked')),
        });
        await open('https://example.com/a');
        await open('mailto:dev@example.com');
        expect(readFileSync(log, 'utf8')).toBe('https://example.com/a\nmailto:dev@example.com\n');
    });
});
