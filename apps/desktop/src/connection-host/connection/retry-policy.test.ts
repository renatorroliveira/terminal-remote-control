import { describe, expect, it } from 'vitest';
import type { ConnectionFailure } from '../../shared/connection';
import type { BootstrapErrorCode } from '../bootstrap/lines';
import { isRetryable, retryDelayMs } from './retry-policy';

const middle = (): number => 0.5;

describe('retryDelayMs (P-29)', () => {
    it('tries at once, then after 1, 2 and 4 s', () => {
        expect([1, 2, 3, 4].map((attempt) => retryDelayMs(attempt, 0, middle))).toEqual([0, 1_000, 2_000, 4_000]);
    });

    it('then every 5 s for five minutes after the loss, then every 30 s', () => {
        expect(retryDelayMs(5, 10_000, middle)).toBe(5_000);
        expect(retryDelayMs(40, 299_000, middle)).toBe(5_000);
        expect(retryDelayMs(41, 300_000, middle)).toBe(30_000);
    });

    it('spreads each delay by up to a fifth either way, never the first try', () => {
        expect(retryDelayMs(2, 0, () => 0)).toBe(800);
        expect(retryDelayMs(2, 0, () => 1)).toBe(1_200);
        expect(retryDelayMs(1, 0, () => 1)).toBe(0);
    });
});

describe('isRetryable (US-2.2.4)', () => {
    const failure = (value: object): ConnectionFailure => ({ details: '', ...value }) as ConnectionFailure;

    it('retries what the network or the host may fix by itself', () => {
        for (const kind of [
            failure({ kind: 'dns', host: 'h' }),
            failure({ kind: 'unreachable', host: 'h', port: 22 }),
            failure({ kind: 'timeout', host: 'h', port: 22 }),
            failure({ kind: 'jump-failed', jump: 'j', cause: 'timeout' }),
            failure({ kind: 'no-answer' }),
            failure({ kind: 'other' }),
            failure({ kind: 'install', code: 'lock-busy' }),
            failure({ kind: 'install', code: 'short-upload' }),
            failure({ kind: 'install', code: 'checksum-mismatch' }),
        ]) {
            expect(isRetryable(kind), JSON.stringify(kind)).toBe(true);
        }
    });

    it('waits for the user when only they can fix it', () => {
        for (const kind of [
            failure({ kind: 'authentication', cause: 'agent-empty' }),
            failure({ kind: 'authentication', cause: 'certificate-expired' }),
            failure({ kind: 'host-key-changed', host: 'h' }),
            failure({ kind: 'host-key-rejected', host: 'h' }),
            failure({ kind: 'host-key-not-kept', host: 'h', file: '~/.ssh/known_hosts' }),
            failure({ kind: 'ssh-missing' }),
            failure({ kind: 'ssh-too-old', version: '7.9' }),
            failure({ kind: 'unsupported', missing: 'os', os: 'x', arch: 'y' }),
            failure({ kind: 'incompatible', minProto: 9, maxProto: 9 }),
            ...(
                [
                    'unsupported-os',
                    'unsupported-arch',
                    'missing-tool',
                    'root-unusable',
                    'root-unsafe',
                    'noexec',
                    'self-test',
                    'not-installed',
                    'protocol',
                    'unknown',
                ] satisfies readonly BootstrapErrorCode[]
            ).map((code) => failure({ kind: 'install', code })),
        ]) {
            expect(isRetryable(kind), JSON.stringify(kind)).toBe(false);
        }
    });
});
