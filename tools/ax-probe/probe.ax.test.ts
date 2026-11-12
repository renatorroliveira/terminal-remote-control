import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);
const PROBE = resolve(import.meta.dirname, '.build/release/ax-probe');

describe('ax-probe', () => {
    it('reports whether this process holds the Accessibility permission', async () => {
        const outcome = await run(PROBE, ['trusted']).then(
            ({ stdout }) => ({ code: 0, stdout }),
            (error: { readonly code: number; readonly stdout: string }) => ({ code: error.code, stdout: error.stdout }),
        );

        expect([0, 2]).toContain(outcome.code);
        expect(outcome.stdout.trim()).toBe(outcome.code === 0 ? 'trusted' : 'not-trusted');
    });

    it('rejects unknown commands with a usage exit code', async () => {
        await expect(run(PROBE, ['nope'])).rejects.toMatchObject({ code: 64 });
    });
});
