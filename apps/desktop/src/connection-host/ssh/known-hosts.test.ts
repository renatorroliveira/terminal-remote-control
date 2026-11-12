import { createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { appendKnownHost, fingerprintOf, knownHostsLine } from './known-hosts';

const presented = {
    host: '[127.0.0.1]:2221',
    type: 'ssh-ed25519',
    key: 'AAAAC3NzaC1lZDI1NTE5AAAAIL3szIGukJu1IsllUcPhNH0eUlRcYY5n4T00aLX4jPfq',
    fingerprint: 'SHA256:amYMTZNRGFuD9xZG9BaN9LdEQKQcpbWqaYkF50ECTU8',
};

describe('fingerprintOf', () => {
    it('computes the SHA-256 fingerprint the way OpenSSH prints it', () => {
        expect(fingerprintOf(presented.key)).toBe(presented.fingerprint);
    });
});

describe('knownHostsLine', () => {
    it('writes the host in plain form', () => {
        expect(knownHostsLine(presented, { hashed: false })).toBe(`[127.0.0.1]:2221 ssh-ed25519 ${presented.key}`);
    });

    it('hashes the host as |1|salt|hmac when ssh hashes known hosts', () => {
        const salt = Buffer.alloc(20, 7);
        const line = knownHostsLine(presented, { hashed: true, salt });
        const expectedHash = createHmac('sha1', salt).update('[127.0.0.1]:2221').digest('base64');
        expect(line).toBe(`|1|${salt.toString('base64')}|${expectedHash} ssh-ed25519 ${presented.key}`);
    });
});

describe('appendKnownHost', () => {
    it('creates the file with mode 0600 and its directory with mode 0700', async () => {
        const dir = join(mkdtempSync(join(tmpdir(), 'trc-kh-')), '.ssh');
        const file = join(dir, 'known_hosts');
        await appendKnownHost(file, 'h ssh-ed25519 AAAA');
        expect(readFileSync(file, 'utf8')).toBe('h ssh-ed25519 AAAA\n');
        expect(statSync(file).mode & 0o777).toBe(0o600);
        expect(statSync(dir).mode & 0o777).toBe(0o700);
    });

    it('starts a new line when the file does not end with one', async () => {
        const file = join(mkdtempSync(join(tmpdir(), 'trc-kh-')), 'known_hosts');
        writeFileSync(file, 'old ssh-rsa AAAA');
        await appendKnownHost(file, 'new ssh-ed25519 BBBB');
        expect(readFileSync(file, 'utf8')).toBe('old ssh-rsa AAAA\nnew ssh-ed25519 BBBB\n');
    });
});
