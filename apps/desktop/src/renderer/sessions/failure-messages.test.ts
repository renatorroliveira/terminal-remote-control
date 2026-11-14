import { createIntl } from 'react-intl';
import { describe, expect, it } from 'vitest';
import type { ConnectionFailure } from '../../shared/connection';
import { failureMessage } from './failure-messages';

const intl = createIntl({ locale: 'en', defaultLocale: 'en', messages: {} });

const FAILURES: readonly ConnectionFailure[] = [
    { kind: 'ssh-missing', details: '' },
    { kind: 'ssh-too-old', version: '8.1', details: '' },
    { kind: 'host-key-changed', host: 'devbox-1', details: '' },
    { kind: 'host-key-rejected', host: 'devbox-1', details: '' },
    ...(
        [
            'no-agent',
            'agent-empty',
            'passphrase-not-loaded',
            'pin-required',
            'certificate-expired',
            'key-rejected',
        ] as const
    ).map((cause): ConnectionFailure => ({ kind: 'authentication', cause, details: '' })),
    { kind: 'dns', host: 'devbox-1', details: '' },
    { kind: 'unreachable', host: 'devbox-1', port: 22, details: '' },
    { kind: 'timeout', host: 'devbox-1', port: 22, details: '' },
    ...(['dns', 'unreachable', 'timeout'] as const).map((cause): ConnectionFailure => ({
        kind: 'jump-failed',
        jump: 'bastion',
        cause,
        details: '',
    })),
    ...(['os', 'arch', 'checksum-tool'] as const).map((missing): ConnectionFailure => ({
        kind: 'unsupported',
        missing,
        os: 'FreeBSD',
        arch: 'riscv64',
        details: '',
    })),
    { kind: 'update-app', installedVersion: '9.0.0', details: '' },
    { kind: 'install', code: 'noexec', details: '' },
    { kind: 'install', code: 'root-unsafe', details: '' },
    { kind: 'install', code: 'upload', details: '' },
    { kind: 'incompatible', minProto: 3, maxProto: 4, details: '' },
    { kind: 'other', details: '' },
];

describe('connection failure messages (US-1.3.1, WCAG 3.3.3)', () => {
    it.each(FAILURES.map((failure) => [JSON.stringify(failure), failure] as const))(
        'say what went wrong and how to fix it: %s',
        (_name, failure) => {
            const { problem, remedy } = failureMessage(intl, 'devbox-1', failure);
            expect(problem).toMatch(/\S/);
            expect(remedy).toMatch(/\S/);
            expect(`${problem} ${remedy}`).not.toMatch(/[{}]/);
            expect(problem).not.toBe(remedy);
        },
    );

    it('gives every cause its own message', () => {
        const problems = FAILURES.map((failure) => failureMessage(intl, 'devbox-1', failure).problem);
        expect(new Set(problems).size).toBe(FAILURES.length);
    });

    it('names the host and port of a timeout, and suggests the network or proxy', () => {
        const { problem, remedy } = failureMessage(intl, 'devbox-1', {
            kind: 'timeout',
            host: 'devbox-1',
            port: 22,
            details: '',
        });
        expect(problem).toBe('devbox-1 didn’t answer on port 22 within 15 seconds.');
        expect(remedy).toContain('VPN or proxy');
    });

    it('tells a noexec home to move the install location (US-1.4.3)', () => {
        const { problem, remedy } = failureMessage(intl, 'devbox-1', { kind: 'install', code: 'noexec', details: '' });
        expect(problem).toContain('mounted noexec');
        expect(remedy).toContain('Choose another install location for devbox-1');
    });

    it('says when other users could change the install location, and how to choose a safe one (SEC-04.4)', () => {
        const failure: ConnectionFailure = { kind: 'install', code: 'root-unsafe', details: '' };
        const { problem, remedy } = failureMessage(intl, 'devbox-1', failure);
        expect(problem).toBe('Other users can change the install location on devbox-1, or a folder above it.');
        expect(remedy).toContain('only you can change');
    });
});
