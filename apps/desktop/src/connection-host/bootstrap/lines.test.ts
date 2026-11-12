import { describe, expect, it } from 'vitest';
import { parseBootstrapLine } from './lines';

const nonce = 'c0ffee';

describe('parseBootstrapLine', () => {
    it('ignores lines without the nonce, such as startup-file noise', () => {
        expect(parseBootstrapLine('Welcome to Ubuntu', nonce)).toBeUndefined();
        expect(parseBootstrapLine('c0ffeeHELLO os=Linux', nonce)).toBeUndefined();
    });

    it('parses hello with the installed daemons', () => {
        const line = `${nonce} HELLO os=Linux arch=arm64 checksum=sha256sum installed=${'a'.repeat(64)}:0.1.0,${'b'.repeat(64)}:0.2.0`;
        expect(parseBootstrapLine(line, nonce)).toEqual({
            kind: 'hello',
            os: 'Linux',
            arch: 'arm64',
            checksum: 'sha256sum',
            installed: [
                { sha256: 'a'.repeat(64), version: '0.1.0' },
                { sha256: 'b'.repeat(64), version: '0.2.0' },
            ],
        });
    });

    it('parses hello without installed daemons', () => {
        const parsed = parseBootstrapLine(`${nonce} HELLO os=Darwin arch=unsupported checksum=none installed=-`, nonce);
        expect(parsed).toEqual({ kind: 'hello', os: 'Darwin', arch: 'unsupported', checksum: 'none', installed: [] });
    });

    it('parses progress, installed and running', () => {
        expect(parseBootstrapLine(`${nonce} PROGRESS verifying`, nonce)).toEqual({
            kind: 'progress',
            step: 'verifying',
        });
        expect(parseBootstrapLine(`${nonce} INSTALLED ${'c'.repeat(64)} 0.1.0`, nonce)).toEqual({
            kind: 'installed',
            sha256: 'c'.repeat(64),
            version: '0.1.0',
        });
        expect(parseBootstrapLine(`${nonce} RUNNING`, nonce)).toEqual({ kind: 'running' });
    });

    it('parses errors with their code and detail', () => {
        expect(parseBootstrapLine(`${nonce} ERROR noexec /home/tester/.trc`, nonce)).toEqual({
            kind: 'error',
            code: 'noexec',
            detail: '/home/tester/.trc',
        });
        expect(parseBootstrapLine(`${nonce} ERROR checksum-mismatch`, nonce)).toEqual({
            kind: 'error',
            code: 'checksum-mismatch',
            detail: '',
        });
        expect(parseBootstrapLine(`${nonce} ERROR quota-exceeded disk full`, nonce)).toEqual({
            kind: 'error',
            code: 'unknown',
            detail: 'quota-exceeded disk full',
        });
    });

    it('treats a malformed line from the host as a protocol error', () => {
        expect(parseBootstrapLine(`${nonce} HELLO os=Linux`, nonce)).toEqual({
            kind: 'error',
            code: 'protocol',
            detail: 'malformed HELLO line',
        });
        expect(parseBootstrapLine(`${nonce} SURPRISE`, nonce)).toEqual({
            kind: 'error',
            code: 'protocol',
            detail: 'unknown line SURPRISE',
        });
    });
});
