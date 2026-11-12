import type { ClientMessage, ServerMessage } from '@trc/protocol';

/** A host key ssh was presented, as the `known-hosts` helper reports it (`%H %t %K %f`, US-1.2). */
export interface PresentedHostKey {
    /** The host in known_hosts form, such as `[127.0.0.1]:2221` or `devbox-1`. */
    readonly host: string;
    /** The key type, such as `ssh-ed25519`. */
    readonly type: string;
    /** The public key, base64. */
    readonly key: string;
    /** The SHA-256 fingerprint, `SHA256:…`. */
    readonly fingerprint: string;
}

/** Why public-key authentication failed (US-1.3.1). */
export type AuthenticationCause =
    'no-agent' | 'agent-empty' | 'passphrase-not-loaded' | 'pin-required' | 'certificate-expired' | 'key-rejected';

/** What a network failure was. */
export type NetworkCause = 'dns' | 'unreachable' | 'timeout';

/** A step of reaching a host's daemon, shown and announced politely (US-1.4.5). */
export type ConnectStep = 'connecting' | 'checking' | 'uploading' | 'verifying' | 'starting' | 'handshake';

/** Why a connection ended for good; each kind has its own message and remedy (US-1.3, US-1.4). */
export type ConnectionFailure = ConnectionFailureKind & {
    /** What the user can copy: ssh's or the host's message, without helper lines (US-1.3.3). */
    readonly details: string;
};

/** The kinds of connection failure. */
export type ConnectionFailureKind =
    | { readonly kind: 'ssh-missing' }
    | { readonly kind: 'ssh-too-old'; readonly version: string }
    | { readonly kind: 'host-key-changed'; readonly host: string }
    | { readonly kind: 'host-key-rejected'; readonly host: string }
    | { readonly kind: 'authentication'; readonly cause: AuthenticationCause }
    | { readonly kind: 'dns'; readonly host: string }
    | { readonly kind: 'unreachable'; readonly host: string; readonly port: number }
    | { readonly kind: 'timeout'; readonly host: string; readonly port: number }
    | { readonly kind: 'jump-failed'; readonly jump: string; readonly cause: NetworkCause }
    | {
          readonly kind: 'unsupported';
          readonly missing: 'os' | 'arch' | 'checksum-tool';
          readonly os: string;
          readonly arch: string;
      }
    | { readonly kind: 'update-app'; readonly installedVersion: string }
    | { readonly kind: 'install'; readonly code: string }
    | { readonly kind: 'incompatible'; readonly minProto: number; readonly maxProto: number }
    | { readonly kind: 'other' };

/** The daemon a connection reached. */
export interface DaemonInfo {
    readonly version: string;
    readonly sha256: string;
    readonly proto: number;
}

/** Why a working connection was lost (US-1.14, NFR-07). */
export type LossReason = 'channel-closed' | 'ping-timeout';

/** A host connection's lifecycle. */
export type ConnectionState =
    | { readonly status: 'idle' }
    | {
          readonly status: 'connecting';
          readonly step: ConnectStep;
          /** A security-key touch request while ssh waits for it (US-1.3.2). */
          readonly touch: string | undefined;
      }
    | { readonly status: 'host-key'; readonly key: PresentedHostKey }
    | { readonly status: 'connected'; readonly daemon: DaemonInfo }
    | { readonly status: 'failed'; readonly failure: ConnectionFailure }
    | { readonly status: 'disconnected'; readonly reason: LossReason }
    | { readonly status: 'closed' };

/** How the renderer names a host connection and where it goes. */
export interface ConnectTarget {
    /** A host alias from the user's SSH config, or `[user@]host`. */
    readonly destination: string;
    /** A port the user typed. */
    readonly port?: number;
    /** The per-host install location (US-1.4.3). */
    readonly installRoot: string;
}

/** A message from the renderer to the connection host, over the MessagePort. */
export type HostRequest =
    | { readonly type: 'connect'; readonly hostId: string; readonly target: ConnectTarget }
    | { readonly type: 'send'; readonly hostId: string; readonly message: ClientMessage }
    | { readonly type: 'input'; readonly hostId: string; readonly stream: number; readonly data: Uint8Array }
    | { readonly type: 'credit'; readonly hostId: string; readonly stream: number; readonly bytes: number }
    | { readonly type: 'accept-host-key'; readonly hostId: string; readonly fingerprint: string }
    | { readonly type: 'reject-host-key'; readonly hostId: string }
    | { readonly type: 'disconnect'; readonly hostId: string };

/** A message from the connection host to the renderer. */
export type HostEvent =
    | { readonly type: 'state'; readonly hostId: string; readonly state: ConnectionState }
    | { readonly type: 'message'; readonly hostId: string; readonly message: ServerMessage }
    | { readonly type: 'output'; readonly hostId: string; readonly stream: number; readonly data: Uint8Array }
    | { readonly type: 'refused'; readonly hostId: string; readonly reason: 'not-connected' | 'invalid' };

/** Request identifiers the connection host keeps for its own pings; the renderer uses the ones below. */
export const RESERVED_REQUEST_IDS = 0x8000_0000;
