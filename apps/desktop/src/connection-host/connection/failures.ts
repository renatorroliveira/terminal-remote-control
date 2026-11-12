import type { AuthenticationCause, ConnectionFailure } from '../../shared/connection';
import type { BootstrapFailure } from '../bootstrap/driver';
import type { SshFailure } from '../ssh/classify';

/**
 * The connection failure for a classified ssh failure. An unknown host key is not a failure, so it has no mapping;
 * the caller asks the user instead.
 */
export function fromSsh(
    failure: Exclude<SshFailure, { kind: 'host-key-unknown' }>,
    cause: AuthenticationCause | undefined,
): ConnectionFailure {
    const { details } = failure;
    switch (failure.kind) {
        case 'authentication':
            return { kind: 'authentication', cause: cause ?? 'key-rejected', details };
        case 'host-key-changed':
            return { kind: 'host-key-changed', host: failure.host, details };
        case 'dns':
            return { kind: 'dns', host: failure.host, details };
        case 'unreachable':
        case 'timeout':
            return { kind: failure.kind, host: failure.host, port: failure.port, details };
        case 'jump-failed':
            return { kind: 'jump-failed', jump: failure.jump, cause: failure.cause, details };
        case 'other':
            return { kind: 'other', details };
    }
}

/** The connection failure for a bootstrap that stopped; a closed channel is classified from ssh instead. */
export function fromBootstrap(failure: Exclude<BootstrapFailure, { kind: 'closed' }>): ConnectionFailure {
    if (failure.kind === 'host') {
        return { kind: 'install', code: failure.code, details: failure.detail };
    }
    const { plan } = failure;
    switch (plan.kind) {
        case 'unsupported':
            return { kind: 'unsupported', missing: plan.missing, os: plan.os, arch: plan.arch, details: '' };
        case 'update-app':
            return { kind: 'update-app', installedVersion: plan.installedVersion, details: '' };
        default:
            return { kind: 'other', details: `unexpected plan ${plan.kind}` };
    }
}
