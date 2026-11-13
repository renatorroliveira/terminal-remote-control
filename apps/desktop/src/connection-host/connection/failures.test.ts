import { describe, expect, it } from 'vitest';
import { fromBootstrap, fromSsh } from './failures';

describe('fromSsh', () => {
    it('maps network and host-key failures, keeping the details', () => {
        expect(fromSsh({ kind: 'dns', host: 'x.invalid', details: 'ssh: Could not resolve' }, undefined)).toEqual({
            kind: 'dns',
            host: 'x.invalid',
            details: 'ssh: Could not resolve',
        });
        expect(fromSsh({ kind: 'host-key-changed', host: 'h', key: undefined, details: 'd' }, undefined)).toEqual({
            kind: 'host-key-changed',
            host: 'h',
            details: 'd',
        });
        expect(fromSsh({ kind: 'jump-failed', jump: 'j', cause: 'timeout', details: '' }, undefined)).toEqual({
            kind: 'jump-failed',
            jump: 'j',
            cause: 'timeout',
            details: '',
        });
    });

    it('adds the diagnosed cause to an authentication failure', () => {
        expect(fromSsh({ kind: 'authentication', details: 'denied' }, 'agent-empty')).toEqual({
            kind: 'authentication',
            cause: 'agent-empty',
            details: 'denied',
        });
        expect(fromSsh({ kind: 'authentication', details: 'denied' }, undefined)).toEqual({
            kind: 'authentication',
            cause: 'key-rejected',
            details: 'denied',
        });
    });
});

describe('fromBootstrap', () => {
    it('maps host errors and plans that stop the install', () => {
        expect(fromBootstrap({ kind: 'host', code: 'noexec', detail: '/home/t/.trc' })).toEqual({
            kind: 'install',
            code: 'noexec',
            details: '/home/t/.trc',
        });
        expect(
            fromBootstrap({ kind: 'plan', plan: { kind: 'unsupported', missing: 'os', os: 'Darwin', arch: 'arm64' } }),
        ).toEqual({ kind: 'unsupported', missing: 'os', os: 'Darwin', arch: 'arm64', details: '' });
        expect(fromBootstrap({ kind: 'plan', plan: { kind: 'update-app', installedVersion: '9.0.0' } })).toEqual({
            kind: 'update-app',
            installedVersion: '9.0.0',
            details: '',
        });
    });

    it('reports a host that stopped answering during the bootstrap (US-1.4.5)', () => {
        expect(fromBootstrap({ kind: 'silent' })).toEqual({ kind: 'no-answer', details: '' });
    });
});
