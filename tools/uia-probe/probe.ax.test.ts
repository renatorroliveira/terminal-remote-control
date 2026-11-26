import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);
const PROBE = resolve(import.meta.dirname, 'target/release/uia-probe.exe');

describe.runIf(process.platform === 'win32' && existsSync(PROBE))('uia-probe (D-69)', () => {
    it('reports, as JSON, when no element of a process takes focus', async () => {
        const outcome = await run(PROBE, ['focused', '1', '100']).catch(
            (error: { code: number; stdout: string }) => error,
        );
        expect('code' in outcome ? outcome.code : 0).toBe(1);
        expect(JSON.parse(outcome.stdout)).toEqual({
            error: expect.stringMatching(/^no element of process 1 took focus; (process \d+|nothing) holds it$/),
        });
    });

    it('rejects unknown commands with a usage exit code', async () => {
        await expect(run(PROBE, ['nope'])).rejects.toMatchObject({ code: 64 });
    });
});
