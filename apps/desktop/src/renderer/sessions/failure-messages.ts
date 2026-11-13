import { defineMessage, type IntlShape, type MessageDescriptor } from 'react-intl';
import type { AuthenticationCause, ConnectionFailure, NetworkCause } from '../../shared/connection';

/** A failed connection in words: what went wrong and how to fix it (US-1.3.1, WCAG 3.3.3). */
export interface FailureText {
    readonly problem: string;
    readonly remedy: string;
}

/** Says what went wrong with the connection to the host named `name`, and how to fix it. */
export function failureMessage(intl: IntlShape, name: string, failure: ConnectionFailure): FailureText {
    const { problem, remedy } = FAILURE_MESSAGES[failureKey(failure)];
    const values = failureValues(name, failure);
    return { problem: intl.formatMessage(problem, values), remedy: intl.formatMessage(remedy, values) };
}

type FailureKey =
    | Exclude<ConnectionFailure['kind'], 'authentication' | 'jump-failed' | 'unsupported'>
    | 'noexec'
    | `authentication-${AuthenticationCause}`
    | `jump-failed-${NetworkCause}`
    | `unsupported-${Extract<ConnectionFailure, { kind: 'unsupported' }>['missing']}`;

interface FailureValues {
    readonly name: string;
    readonly host: string;
    readonly port: number;
    readonly jump: string;
    readonly version: string;
    readonly os: string;
    readonly arch: string;
    readonly installedVersion: string;
    readonly code: string;
    readonly minProto: number;
    readonly maxProto: number;
    readonly [key: string]: string | number;
}

const NO_VALUES = {
    host: '',
    port: 0,
    jump: '',
    version: '',
    os: '',
    arch: '',
    installedVersion: '',
    code: '',
    minProto: 0,
    maxProto: 0,
} as const;

const FAILURE_MESSAGES: Readonly<
    Record<FailureKey, { readonly problem: MessageDescriptor; readonly remedy: MessageDescriptor }>
> = {
    'ssh-missing': {
        problem: defineMessage<FailureValues>({
            id: 'failure.sshMissing.problem',
            defaultMessage: 'This Mac has no OpenSSH client.',
            description: 'What went wrong when a connection failed.',
        }),
        remedy: defineMessage<FailureValues>({
            id: 'failure.sshMissing.remedy',
            defaultMessage: 'Install OpenSSH 8.5 or later, then connect again.',
            description: 'How to fix a failed connection.',
        }),
    },
    'ssh-too-old': {
        problem: defineMessage<FailureValues>({
            id: 'failure.sshTooOld.problem',
            defaultMessage: 'This Mac’s OpenSSH is version {version}, and the app needs 8.5 or later.',
            description: 'What went wrong when a connection failed.',
        }),
        remedy: defineMessage<FailureValues>({
            id: 'failure.sshTooOld.remedy',
            defaultMessage: 'Update OpenSSH, then connect again.',
            description: 'How to fix a failed connection.',
        }),
    },
    'host-key-changed': {
        problem: defineMessage<FailureValues>({
            id: 'failure.hostKeyChanged.problem',
            defaultMessage:
                'The host key of {name} has changed. Someone may be intercepting the connection, or the host was reinstalled.',
            description: 'What went wrong when a connection failed.',
        }),
        remedy: defineMessage<FailureValues>({
            id: 'failure.hostKeyChanged.remedy',
            defaultMessage:
                'Ask the host’s administrator for its new key fingerprint. Only if it matches, remove the old key with ssh-keygen -R {host}, then connect again.',
            description: 'How to fix a failed connection.',
        }),
    },
    'host-key-rejected': {
        problem: defineMessage<FailureValues>({
            id: 'failure.hostKeyRejected.problem',
            defaultMessage: 'You didn’t trust the host key of {name}, so the app didn’t connect.',
            description: 'What went wrong when a connection failed.',
        }),
        remedy: defineMessage<FailureValues>({
            id: 'failure.hostKeyRejected.remedy',
            defaultMessage: 'Connect again to review the key.',
            description: 'How to fix a failed connection.',
        }),
    },
    'authentication-no-agent': {
        problem: defineMessage<FailureValues>({
            id: 'failure.authenticationNoAgent.problem',
            defaultMessage: 'No SSH agent is running, so ssh had no key to offer {name}.',
            description: 'What went wrong when a connection failed.',
        }),
        remedy: defineMessage<FailureValues>({
            id: 'failure.authenticationNoAgent.remedy',
            defaultMessage: 'Start ssh-agent and add your key with ssh-add, then connect again.',
            description: 'How to fix a failed connection.',
        }),
    },
    'authentication-agent-empty': {
        problem: defineMessage<FailureValues>({
            id: 'failure.authenticationAgentEmpty.problem',
            defaultMessage: 'Your SSH agent holds no keys, so ssh had no key to offer {name}.',
            description: 'What went wrong when a connection failed.',
        }),
        remedy: defineMessage<FailureValues>({
            id: 'failure.authenticationAgentEmpty.remedy',
            defaultMessage: 'Add your key with ssh-add, then connect again.',
            description: 'How to fix a failed connection.',
        }),
    },
    'authentication-passphrase-not-loaded': {
        problem: defineMessage<FailureValues>({
            id: 'failure.authenticationPassphraseNotLoaded.problem',
            defaultMessage: 'Your key needs its passphrase, and it isn’t loaded in your SSH agent.',
            description: 'What went wrong when a connection failed.',
        }),
        remedy: defineMessage<FailureValues>({
            id: 'failure.authenticationPassphraseNotLoaded.remedy',
            defaultMessage: 'Add the key with ssh-add, which asks for the passphrase, then connect again.',
            description: 'How to fix a failed connection.',
        }),
    },
    'authentication-pin-required': {
        problem: defineMessage<FailureValues>({
            id: 'failure.authenticationPinRequired.problem',
            defaultMessage: 'Your security key needs its PIN, which the app can’t ask for.',
            description: 'What went wrong when a connection failed.',
        }),
        remedy: defineMessage<FailureValues>({
            id: 'failure.authenticationPinRequired.remedy',
            defaultMessage: 'Add the key to your SSH agent with ssh-add, which asks for the PIN, then connect again.',
            description: 'How to fix a failed connection.',
        }),
    },
    'authentication-certificate-expired': {
        problem: defineMessage<FailureValues>({
            id: 'failure.authenticationCertificateExpired.problem',
            defaultMessage: 'Your SSH certificate has expired, so {name} refused it.',
            description: 'What went wrong when a connection failed.',
        }),
        remedy: defineMessage<FailureValues>({
            id: 'failure.authenticationCertificateExpired.remedy',
            defaultMessage: 'Renew your certificate, then connect again.',
            description: 'How to fix a failed connection.',
        }),
    },
    'authentication-key-rejected': {
        problem: defineMessage<FailureValues>({
            id: 'failure.authenticationKeyRejected.problem',
            defaultMessage: '{name} refused every key ssh offered.',
            description: 'What went wrong when a connection failed.',
        }),
        remedy: defineMessage<FailureValues>({
            id: 'failure.authenticationKeyRejected.remedy',
            defaultMessage:
                'Check that your public key is in the host’s authorized_keys for the right user, then connect again.',
            description: 'How to fix a failed connection.',
        }),
    },
    dns: {
        problem: defineMessage<FailureValues>({
            id: 'failure.dns.problem',
            defaultMessage: '{name} couldn’t be found.',
            description: 'What went wrong when a connection failed.',
        }),
        remedy: defineMessage<FailureValues>({
            id: 'failure.dns.remedy',
            defaultMessage: 'Check the host name, your network and your DNS, then connect again.',
            description: 'How to fix a failed connection.',
        }),
    },
    unreachable: {
        problem: defineMessage<FailureValues>({
            id: 'failure.unreachable.problem',
            defaultMessage: '{name} refused or dropped the connection on port {port}.',
            description: 'What went wrong when a connection failed.',
        }),
        remedy: defineMessage<FailureValues>({
            id: 'failure.unreachable.remedy',
            defaultMessage: 'Check that the host is running and that SSH listens on port {port}, then connect again.',
            description: 'How to fix a failed connection.',
        }),
    },
    timeout: {
        problem: defineMessage<FailureValues>({
            id: 'failure.timeout.problem',
            defaultMessage: '{name} didn’t answer on port {port} within 15 seconds.',
            description: 'What went wrong when a connection failed.',
        }),
        remedy: defineMessage<FailureValues>({
            id: 'failure.timeout.remedy',
            defaultMessage:
                'Check your network, your VPN or proxy settings, and that the host is running, then connect again.',
            description: 'How to fix a failed connection.',
        }),
    },
    'jump-failed-dns': {
        problem: defineMessage<FailureValues>({
            id: 'failure.jumpFailedDns.problem',
            defaultMessage: 'The jump host {jump} couldn’t be found.',
            description: 'What went wrong when a connection failed.',
        }),
        remedy: defineMessage<FailureValues>({
            id: 'failure.jumpFailedDns.remedy',
            defaultMessage: 'Check the jump host in your SSH config, then connect again.',
            description: 'How to fix a failed connection.',
        }),
    },
    'jump-failed-unreachable': {
        problem: defineMessage<FailureValues>({
            id: 'failure.jumpFailedUnreachable.problem',
            defaultMessage: 'The jump host {jump} refused or dropped the connection.',
            description: 'What went wrong when a connection failed.',
        }),
        remedy: defineMessage<FailureValues>({
            id: 'failure.jumpFailedUnreachable.remedy',
            defaultMessage: 'Check that the jump host is running and reachable, then connect again.',
            description: 'How to fix a failed connection.',
        }),
    },
    'jump-failed-timeout': {
        problem: defineMessage<FailureValues>({
            id: 'failure.jumpFailedTimeout.problem',
            defaultMessage: 'The jump host {jump} didn’t answer in time.',
            description: 'What went wrong when a connection failed.',
        }),
        remedy: defineMessage<FailureValues>({
            id: 'failure.jumpFailedTimeout.remedy',
            defaultMessage: 'Check your network and the jump host, then connect again.',
            description: 'How to fix a failed connection.',
        }),
    },
    'unsupported-os': {
        problem: defineMessage<FailureValues>({
            id: 'failure.unsupportedOs.problem',
            defaultMessage: '{name} runs {os}, which the daemon doesn’t support yet.',
            description: 'What went wrong when a connection failed.',
        }),
        remedy: defineMessage<FailureValues>({
            id: 'failure.unsupportedOs.remedy',
            defaultMessage: 'Connect to a Linux host on x86_64 or arm64.',
            description: 'How to fix a failed connection.',
        }),
    },
    'unsupported-arch': {
        problem: defineMessage<FailureValues>({
            id: 'failure.unsupportedArch.problem',
            defaultMessage: '{name} has a {arch} processor, which the daemon doesn’t support.',
            description: 'What went wrong when a connection failed.',
        }),
        remedy: defineMessage<FailureValues>({
            id: 'failure.unsupportedArch.remedy',
            defaultMessage: 'Connect to a Linux host on x86_64 or arm64.',
            description: 'How to fix a failed connection.',
        }),
    },
    'unsupported-checksum-tool': {
        problem: defineMessage<FailureValues>({
            id: 'failure.unsupportedChecksumTool.problem',
            defaultMessage: '{name} has neither sha256sum nor shasum, so the app can’t verify the daemon it uploads.',
            description: 'What went wrong when a connection failed.',
        }),
        remedy: defineMessage<FailureValues>({
            id: 'failure.unsupportedChecksumTool.remedy',
            defaultMessage: 'Install sha256sum or shasum on the host, then connect again.',
            description: 'How to fix a failed connection.',
        }),
    },
    'update-app': {
        problem: defineMessage<FailureValues>({
            id: 'failure.updateApp.problem',
            defaultMessage: '{name} runs a newer daemon, version {installedVersion}, than this app.',
            description: 'What went wrong when a connection failed.',
        }),
        remedy: defineMessage<FailureValues>({
            id: 'failure.updateApp.remedy',
            defaultMessage: 'Update the app, then connect again.',
            description: 'How to fix a failed connection.',
        }),
    },
    noexec: {
        problem: defineMessage<FailureValues>({
            id: 'failure.noexec.problem',
            defaultMessage: 'The install location on {name} doesn’t allow running programs; it is mounted noexec.',
            description: 'What went wrong when a connection failed.',
        }),
        remedy: defineMessage<FailureValues>({
            id: 'failure.noexec.remedy',
            defaultMessage:
                'Choose another install location for {name} from its actions (Shift+F10), such as a folder on another disk, then connect again.',
            description: 'How to fix a failed connection.',
        }),
    },
    install: {
        problem: defineMessage<FailureValues>({
            id: 'failure.install.problem',
            defaultMessage: 'The daemon couldn’t be installed on {name} ({code}).',
            description: 'What went wrong when a connection failed.',
        }),
        remedy: defineMessage<FailureValues>({
            id: 'failure.install.remedy',
            defaultMessage: 'Check the install location’s free space and permissions, then connect again.',
            description: 'How to fix a failed connection.',
        }),
    },
    incompatible: {
        problem: defineMessage<FailureValues>({
            id: 'failure.incompatible.problem',
            defaultMessage:
                'The daemon on {name} speaks protocol versions {minProto} to {maxProto}, which this app doesn’t.',
            description: 'What went wrong when a connection failed.',
        }),
        remedy: defineMessage<FailureValues>({
            id: 'failure.incompatible.remedy',
            defaultMessage: 'Update the app, then connect again.',
            description: 'How to fix a failed connection.',
        }),
    },
    other: {
        problem: defineMessage<FailureValues>({
            id: 'failure.other.problem',
            defaultMessage: 'The connection to {name} failed.',
            description: 'What went wrong when a connection failed.',
        }),
        remedy: defineMessage<FailureValues>({
            id: 'failure.other.remedy',
            defaultMessage: 'Read the details, then connect again.',
            description: 'How to fix a failed connection.',
        }),
    },
};

function failureKey(failure: ConnectionFailure): FailureKey {
    switch (failure.kind) {
        case 'authentication':
            return `authentication-${failure.cause}`;
        case 'jump-failed':
            return `jump-failed-${failure.cause}`;
        case 'unsupported':
            return `unsupported-${failure.missing}`;
        case 'install':
            return failure.code === 'noexec' ? 'noexec' : 'install';
        default:
            return failure.kind;
    }
}

function failureValues(name: string, failure: ConnectionFailure): FailureValues {
    return { ...NO_VALUES, ...failure, name };
}
