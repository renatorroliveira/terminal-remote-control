import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AuthProbes } from './classify';
import { classifyFailure, diagnoseAuthentication } from './classify';
import type { EffectiveConfig } from './client-checks';

const corpus = resolve(import.meta.dirname, '../../../../../docs/spikes/s4');

function stderrOf(name: string): string[] {
    const text = readFileSync(join(corpus, `${name}.txt`), 'utf8');
    return text
        .slice(text.indexOf('stderr:\n') + 'stderr:\n'.length)
        .split('\n')
        .filter((line) => line !== '');
}

const direct: EffectiveConfig = {
    user: 'tester',
    hostname: '127.0.0.1',
    port: 2221,
    identityFiles: [],
    certificateFiles: [],
    knownHostsFiles: [],
    hashKnownHosts: false,
    proxyJump: undefined,
};

describe('classifyFailure on the S4 corpus (US-1.3.1)', () => {
    it('recognizes an unknown host key and keeps the presented key', () => {
        const failure = classifyFailure(stderrOf('hostkey-unknown'), 'n0nce', direct);
        expect(failure).toMatchObject({
            kind: 'host-key-unknown',
            key: { host: '[127.0.0.1]:2221', type: 'ssh-ed25519' },
        });
    });

    it('picks the jump host key or the target key, whichever ssh named', () => {
        const jump = { ...direct, hostname: 'behind', port: 22, proxyJump: 'trc-jump' };
        expect(classifyFailure(stderrOf('jump-hostkey-unknown-jump'), 'n0nce', jump)).toMatchObject({
            kind: 'host-key-unknown',
            key: { host: '[127.0.0.1]:2225' },
        });
        expect(classifyFailure(stderrOf('jump-hostkey-unknown-target'), 'n0nce', jump)).toMatchObject({
            kind: 'host-key-unknown',
            key: { host: 'behind' },
        });
    });

    it('refuses a changed host key', () => {
        expect(classifyFailure(stderrOf('hostkey-changed'), 'n0nce', direct)).toMatchObject({
            kind: 'host-key-changed',
            host: '[127.0.0.1]:2221',
        });
    });

    it('defers authentication failures to the probes', () => {
        for (const name of ['key-rejected', 'cert-expired', 'no-agent-passphrase-key', 'agent-empty-passphrase-key']) {
            expect(classifyFailure(stderrOf(name), 'n0nce', direct)).toMatchObject({ kind: 'authentication' });
        }
    });

    it('tells DNS failures, refused connections and timeouts apart', () => {
        const dns = { ...direct, hostname: 'no-such-host.invalid', port: 22 };
        expect(classifyFailure(stderrOf('dns-failure'), 'n0nce', dns)).toMatchObject({
            kind: 'dns',
            host: 'no-such-host.invalid',
        });
        const refused = { ...direct, port: 2299 };
        expect(classifyFailure(stderrOf('host-unreachable'), 'n0nce', refused)).toMatchObject({
            kind: 'unreachable',
            host: '127.0.0.1',
            port: 2299,
        });
        const timeout = { ...direct, hostname: '10.255.255.1', port: 22 };
        expect(classifyFailure(stderrOf('timeout'), 'n0nce', timeout)).toMatchObject({
            kind: 'timeout',
            host: '10.255.255.1',
        });
    });

    it('blames the jump host when ssh names a host that is not the target', () => {
        const viaJump = { ...direct, hostname: 'behind', port: 22, proxyJump: 'trc-unreachable' };
        expect(classifyFailure(stderrOf('jump-failure'), 'n0nce', viaJump)).toMatchObject({
            kind: 'jump-failed',
            jump: 'trc-unreachable',
            cause: 'unreachable',
        });
    });

    it('keeps the shown details free of helper lines', () => {
        const failure = classifyFailure(stderrOf('key-rejected'), 'n0nce', direct);
        expect(failure.details).toBe('tester@127.0.0.1: Permission denied (publickey).');
    });

    it('falls back to a generic failure', () => {
        expect(
            classifyFailure(['kex_exchange_identification: Connection closed by remote host'], 'n0nce', direct),
        ).toMatchObject({
            kind: 'other',
        });
    });

    it('says so when ssh ended without a message, as when a busy server drops the connection', () => {
        expect(classifyFailure([], 'n0nce', direct)).toEqual({
            kind: 'other',
            details: 'ssh ended the connection without a message.',
        });
        expect(classifyFailure(['', '\r'], 'n0nce', direct).details).toBe(
            'ssh ended the connection without a message.',
        );
    });
});

function probes(overrides: Partial<AuthProbes>): AuthProbes {
    return {
        agent: async () => 'none',
        agentKeys: async () => [],
        identity: async () => ({ exists: true, encrypted: false, publicKey: 'ssh-ed25519 AAAA' }),
        certificateExpired: async () => false,
        ...overrides,
    };
}

describe('diagnoseAuthentication (US-1.3.1)', () => {
    const withKey = { ...direct, identityFiles: ['/k/id_ed25519'] };

    it('reports an expired certificate first', async () => {
        const config = { ...withKey, certificateFiles: ['/k/id-cert.pub'] };
        expect(await diagnoseAuthentication(config, probes({ certificateExpired: async () => true }))).toBe(
            'certificate-expired',
        );
    });

    it('reports a passphrase key that the agent does not hold, by agent state', async () => {
        const encrypted = probes({
            identity: async () => ({ exists: true, encrypted: true, publicKey: 'ssh-ed25519 PASS' }),
        });
        expect(await diagnoseAuthentication(withKey, encrypted)).toBe('no-agent');
        expect(await diagnoseAuthentication(withKey, { ...encrypted, agent: async () => 'empty' })).toBe('agent-empty');
        const loadedOther = {
            ...encrypted,
            agent: async () => 'loaded' as const,
            agentKeys: async () => ['ssh-ed25519 OTHER'],
        };
        expect(await diagnoseAuthentication(withKey, loadedOther)).toBe('passphrase-not-loaded');
    });

    it('reports a security key that needs a PIN', async () => {
        const securityKey = probes({
            identity: async () => ({ exists: true, encrypted: false, publicKey: 'sk-ssh-ed25519@openssh.com AAAA' }),
        });
        expect(await diagnoseAuthentication(withKey, securityKey)).toBe('pin-required');
    });

    it('reports no usable key by agent state', async () => {
        const missing = probes({ identity: async () => ({ exists: false, encrypted: false, publicKey: undefined }) });
        expect(await diagnoseAuthentication(withKey, missing)).toBe('no-agent');
        expect(await diagnoseAuthentication(withKey, { ...missing, agent: async () => 'empty' })).toBe('agent-empty');
    });

    it('otherwise says the host rejected the key', async () => {
        expect(await diagnoseAuthentication(withKey, probes({}))).toBe('key-rejected');
        expect(await diagnoseAuthentication(direct, probes({ agent: async () => 'loaded' }))).toBe('key-rejected');
    });
});
