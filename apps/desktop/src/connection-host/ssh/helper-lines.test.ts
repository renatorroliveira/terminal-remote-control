import { describe, expect, it } from 'vitest';
import { parseHelperLine, shownDetails } from './helper-lines';

const nonce = 'n0nce';
const key = 'AAAAC3NzaC1lZDI1NTE5AAAAIL3szIGukJu1IsllUcPhNH0eUlRcYY5n4T00aLX4jPfq';

describe('parseHelperLine', () => {
    it('reads a presented host key', () => {
        const line = `n0nce HOSTKEY [127.0.0.1]:2221 ssh-ed25519 ${key} SHA256:amYMTZNRGFuD9xZG9BaN9LdEQKQcpbWqaYkF50ECTU8`;
        expect(parseHelperLine(line, nonce)).toEqual({
            kind: 'host-key',
            key: {
                host: '[127.0.0.1]:2221',
                type: 'ssh-ed25519',
                key,
                fingerprint: 'SHA256:amYMTZNRGFuD9xZG9BaN9LdEQKQcpbWqaYkF50ECTU8',
            },
        });
    });

    it('reads a notice such as a security-key touch request', () => {
        expect(parseHelperLine('n0nce NOTICE Confirm user presence for key ED25519-SK SHA256:x', nonce)).toEqual({
            kind: 'notice',
            text: 'Confirm user presence for key ED25519-SK SHA256:x',
        });
    });

    it('ignores ssh messages and lines with another nonce', () => {
        expect(parseHelperLine('tester@127.0.0.1: Permission denied (publickey).', nonce)).toBeUndefined();
        expect(parseHelperLine(`other HOSTKEY h ssh-ed25519 ${key} SHA256:x`, nonce)).toBeUndefined();
    });
});

describe('shownDetails', () => {
    it('strips helper lines from what the user sees and copies (US-1.3.3)', () => {
        const stderr = [
            `n0nce HOSTKEY h t ${key} f`,
            'n0nce NOTICE touch',
            'ssh: connect to host h port 22: Connection refused',
        ];
        expect(shownDetails(stderr, nonce)).toBe('ssh: connect to host h port 22: Connection refused');
    });
});
