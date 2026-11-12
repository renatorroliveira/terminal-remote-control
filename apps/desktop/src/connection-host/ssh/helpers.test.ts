import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const bin = resolve(import.meta.dirname, '../../../resources/bin');

function run(helper: string, args: string[], env: Record<string, string>) {
    return spawnSync(join(bin, helper), args, { env: { PATH: '/usr/bin:/bin', ...env }, encoding: 'utf8' });
}

describe('known-hosts helper (US-1.2)', () => {
    it('reports the presented key behind the nonce and returns no keys', () => {
        const result = run('known-hosts', ['ADDRESS', '[h]:22', 'ssh-ed25519', 'AAAA', 'SHA256:x'], {
            TRC_SSH_NONCE: 'n1',
        });
        expect(result.status).toBe(0);
        expect(result.stdout).toBe('');
        expect(result.stderr).toBe('n1 HOSTKEY [h]:22 ssh-ed25519 AAAA SHA256:x\n');
    });

    it('stays silent for the ORDER call', () => {
        const result = run('known-hosts', ['ORDER', 'h', 'NONE', 'NONE', 'NONE'], { TRC_SSH_NONCE: 'n1' });
        expect([result.status, result.stdout, result.stderr]).toEqual([0, '', '']);
    });
});

describe('askpass helper (US-1.1.3, US-1.3.2)', () => {
    it('relays a notice such as a security-key touch request', () => {
        const result = run('askpass', ['Confirm user presence for key ED25519-SK'], {
            TRC_SSH_NONCE: 'n2',
            SSH_ASKPASS_PROMPT: 'none',
        });
        expect(result.status).toBe(0);
        expect(result.stdout).toBe('');
        expect(result.stderr).toBe('n2 NOTICE Confirm user presence for key ED25519-SK\n');
    });

    it.each(['', 'confirm'])('refuses every prompt (SSH_ASKPASS_PROMPT=%j) without printing anything', (prompt) => {
        const result = run('askpass', ['Enter passphrase for key:'], {
            TRC_SSH_NONCE: 'n2',
            SSH_ASKPASS_PROMPT: prompt,
        });
        expect(result.status).not.toBe(0);
        expect(result.stdout).toBe('');
        expect(result.stderr).toBe('');
    });
});
