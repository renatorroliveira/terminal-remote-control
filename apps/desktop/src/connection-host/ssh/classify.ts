import type { EffectiveConfig } from './client-checks';
import type { PresentedHostKey } from './helper-lines';
import { parseHelperLine, shownDetails } from './helper-lines';

/** Why public-key authentication failed (US-1.3.1). */
export type AuthenticationCause =
    'no-agent' | 'agent-empty' | 'passphrase-not-loaded' | 'pin-required' | 'certificate-expired' | 'key-rejected';

/** What a network failure was. */
export type NetworkCause = 'dns' | 'unreachable' | 'timeout';

/** Why ssh failed, with ssh's message minus the helper lines as copyable details (US-1.3). */
export type SshFailure = SshFailureKind & { readonly details: string };

/** The kinds of ssh failure. */
export type SshFailureKind =
    | { readonly kind: 'host-key-unknown'; readonly key: PresentedHostKey }
    | { readonly kind: 'host-key-changed'; readonly host: string; readonly key: PresentedHostKey | undefined }
    | { readonly kind: 'authentication' }
    | { readonly kind: 'dns'; readonly host: string }
    | { readonly kind: 'unreachable'; readonly host: string; readonly port: number }
    | { readonly kind: 'timeout'; readonly host: string; readonly port: number }
    | { readonly kind: 'jump-failed'; readonly jump: string; readonly cause: NetworkCause }
    | { readonly kind: 'other' };

/** Local checks that explain a refused public key. */
export interface AuthProbes {
    /** `ssh-add -l`: exit 2 means no agent, 1 an empty agent. */
    readonly agent: () => Promise<'none' | 'empty' | 'loaded'>;
    /** `ssh-add -L`: the public keys the agent holds, as `type base64`. */
    readonly agentKeys: () => Promise<readonly string[]>;
    /** One `IdentityFile`: whether it exists, whether it needs a passphrase, and its public key. */
    readonly identity: (path: string) => Promise<IdentityProbe>;
    /** Whether a certificate file exists and its validity has ended. */
    readonly certificateExpired: (path: string) => Promise<boolean>;
}

/** What the probes found about one identity file. */
export interface IdentityProbe {
    readonly exists: boolean;
    readonly encrypted: boolean;
    readonly publicKey: string | undefined;
}

type Matcher = (
    stderr: readonly string[],
    keys: readonly PresentedHostKey[],
    config: EffectiveConfig,
) => SshFailureKind | undefined;

const CHANGED = /Host key for (\S+) has changed and you have requested strict checking/;
const UNKNOWN = /No \S+ host key is known for (\S+) and you have requested strict checking/;
const DENIED = /Permission denied \([^)]*publickey/;
const UNRESOLVED = /Could not resolve hostname ([^\s:]+)/;
const CONNECT = /connect to host (\S+) port (\d+): (.+)$/;
const TIMED_OUT = /timed out/i;

const MATCHERS: readonly Matcher[] = [
    (stderr, keys) => {
        const host = firstMatch(stderr, CHANGED);
        return host === undefined
            ? undefined
            : { kind: 'host-key-changed', host, key: keys.find((key) => key.host === host) };
    },
    (stderr, keys) => {
        const host = firstMatch(stderr, UNKNOWN);
        const key = keys.findLast((presented) => presented.host === host);
        return key === undefined ? undefined : { kind: 'host-key-unknown', key };
    },
    (stderr) => (stderr.some((line) => DENIED.test(line)) ? { kind: 'authentication' } : undefined),
    (stderr, _keys, config) => {
        const host = firstMatch(stderr, UNRESOLVED);
        if (host === undefined) {
            return undefined;
        }
        return viaJump(config, host !== config.hostname) ?? { kind: 'dns', host };
    },
    (stderr, _keys, config) => {
        const match = stderr.map((line) => CONNECT.exec(line)).find((found) => found !== null);
        if (match === undefined || match === null) {
            return undefined;
        }
        const [, host = '', port = '0', reason = ''] = match;
        const cause = TIMED_OUT.test(reason) ? 'timeout' : 'unreachable';
        const elsewhere = host !== config.hostname || Number(port) !== config.port;
        return viaJump(config, elsewhere, cause) ?? { kind: cause, host, port: Number(port) };
    },
];

/**
 * Classifies a failed connection from ssh's stderr lines and the effective settings (US-1.3.1, the S4 corpus). ssh
 * ends some messages with `\r\n`, so carriage returns are dropped first.
 */
export function classifyFailure(raw: readonly string[], nonce: string, config: EffectiveConfig): SshFailure {
    const stderr = raw.map((line) => line.replace(/\r$/, ''));
    const keys = stderr
        .map((line) => parseHelperLine(line, nonce))
        .flatMap((line) => (line?.kind === 'host-key' ? [line.key] : []));
    const details = shownDetails(stderr, nonce);
    for (const matcher of MATCHERS) {
        const kind = matcher(stderr, keys, config);
        if (kind !== undefined) {
            return { ...kind, details };
        }
    }
    return { kind: 'other', details };
}

/**
 * Explains a refused public key with local checks, most specific first: an expired certificate, a passphrase key
 * the agent does not hold, a security key that needs a PIN, no usable key at all, and otherwise a key the host
 * rejected.
 */
export async function diagnoseAuthentication(
    config: EffectiveConfig,
    probes: AuthProbes,
): Promise<AuthenticationCause> {
    const certificates = [...config.certificateFiles, ...config.identityFiles.map((file) => `${file}-cert.pub`)];
    const expired = await Promise.all(certificates.map((file) => probes.certificateExpired(file)));
    if (expired.includes(true)) {
        return 'certificate-expired';
    }
    const identities = (await Promise.all(config.identityFiles.map((file) => probes.identity(file)))).filter(
        (identity) => identity.exists,
    );
    const agent = await probes.agent();
    const agentKeys = agent === 'loaded' ? await probes.agentKeys() : [];
    const held = (publicKey: string | undefined): boolean =>
        publicKey !== undefined && agentKeys.some((agentKey) => samePublicKey(agentKey, publicKey));
    if (identities.some((identity) => identity.encrypted && !held(identity.publicKey))) {
        return byAgent(agent, 'passphrase-not-loaded');
    }
    if (
        [...identities.map((identity) => identity.publicKey ?? ''), ...agentKeys].some((key) => key.startsWith('sk-'))
    ) {
        return 'pin-required';
    }
    if (identities.length === 0 && agent !== 'loaded') {
        return byAgent(agent, 'key-rejected');
    }
    return 'key-rejected';
}

function byAgent(agent: 'none' | 'empty' | 'loaded', loaded: AuthenticationCause): AuthenticationCause {
    if (agent === 'none') {
        return 'no-agent';
    }
    return agent === 'empty' ? 'agent-empty' : loaded;
}

function viaJump(config: EffectiveConfig, elsewhere: boolean, cause: NetworkCause = 'dns'): SshFailureKind | undefined {
    return elsewhere && config.proxyJump !== undefined
        ? { kind: 'jump-failed', jump: config.proxyJump, cause }
        : undefined;
}

function firstMatch(stderr: readonly string[], pattern: RegExp): string | undefined {
    for (const line of stderr) {
        const match = pattern.exec(line);
        if (match?.[1] !== undefined) {
            return match[1];
        }
    }
    return undefined;
}

function samePublicKey(left: string, right: string): boolean {
    const [leftType, leftKey] = left.split(' ');
    const [rightType, rightKey] = right.split(' ');
    return leftType === rightType && leftKey === rightKey;
}
