import { defineMessage, defineMessages } from 'react-intl';
import type { ConnectStep } from '../../shared/connection';

/** Each step of reaching a host's daemon, shown and announced politely (US-1.4.5). */
export const connectStepMessages = defineMessages<ConnectStep>({
    connecting: { id: 'step.connecting', defaultMessage: 'Connecting', description: 'Connection step.' },
    checking: { id: 'step.checking', defaultMessage: 'Checking the daemon', description: 'Connection step.' },
    uploading: { id: 'step.uploading', defaultMessage: 'Uploading the daemon', description: 'Connection step.' },
    verifying: { id: 'step.verifying', defaultMessage: 'Verifying the daemon', description: 'Connection step.' },
    starting: { id: 'step.starting', defaultMessage: 'Starting the daemon', description: 'Connection step.' },
    handshake: {
        id: 'step.handshake',
        defaultMessage: 'Greeting the daemon',
        description: 'Connection step: the app and the daemon agree on a protocol version.',
    },
});

/** A connection step, naming the host, as announced. */
export const connectStepAnnouncement = defineMessage<{ host: string; step: string }>({
    id: 'announce.connectStep',
    defaultMessage: '{host}: {step}.',
    description: 'Announced politely at each step of connecting.',
});

/** The security-key prompt (US-1.3.2). */
export const touchMessage = defineMessage<{ host: string }>({
    id: 'host.touch',
    defaultMessage: 'Touch your security key for {host}',
    description: 'Shown and announced while ssh waits for a FIDO security key touch.',
});

/** Host actions in context menus and the palette (US-1.1.5, US-1.4.3, A11Y-11.9). */
export const hostActionMessages = {
    test: defineMessage<{ host: string }>({
        id: 'host.action.test',
        defaultMessage: 'Test connection to {host}',
        description: 'Host action.',
    }),
    installRoot: defineMessage<{ host: string }>({
        id: 'host.action.installRoot',
        defaultMessage: 'Change install location of {host}…',
        description: 'Host action that opens a dialog.',
    }),
    forget: defineMessage<{ host: string }>({
        id: 'host.action.forget',
        defaultMessage: 'Forget {host}…',
        description: 'Host action that asks for confirmation.',
    }),
    testPassed: defineMessage<{ host: string }>({
        id: 'host.testPassed',
        defaultMessage: 'The connection to {host} works.',
        description: 'Announced when a connection test succeeds.',
    }),
};

/** The host key dialog (US-1.2.1). */
export const hostKeyDialogMessages = {
    title: defineMessage<{ host: string }>({
        id: 'hostKey.title',
        defaultMessage: 'Trust the host key of {host}?',
        description: 'Dialog title.',
    }),
    explanation: defineMessage<{ host: string; type: string }>({
        id: 'hostKey.explanation',
        defaultMessage:
            '{host} presented a {type} key that your known_hosts file doesn’t have. Compare its fingerprint with one from the host’s administrator before you trust it.',
        description: 'Dialog text.',
    }),
    fingerprint: defineMessage({
        id: 'hostKey.fingerprint',
        defaultMessage: 'SHA-256 fingerprint',
        description: 'Label of the read-only field holding the fingerprint.',
    }),
};

/** The Forget host confirmation (A11Y-11.9). */
export const forgetMessages = {
    title: defineMessage<{ host: string }>({
        id: 'forget.title',
        defaultMessage: 'Forget {host}?',
        description: 'Confirmation title.',
    }),
    body: defineMessage<{ host: string }>({
        id: 'forget.body',
        defaultMessage:
            'TRC removes {host} from your hosts and closes its connection. Its sessions keep running on the host, and adding it again shows them.',
        description: 'Says what forgetting deletes and what it keeps.',
    }),
    confirm: defineMessage({ id: 'forget.confirm', defaultMessage: 'Forget', description: 'Button.' }),
    cancel: defineMessage({ id: 'forget.cancel', defaultMessage: 'Cancel', description: 'Button.' }),
};

/** The install location dialog (US-1.4.3). */
export const installRootMessages = {
    title: defineMessage<{ host: string }>({
        id: 'installRoot.title',
        defaultMessage: 'Install location of {host}',
        description: 'Dialog title.',
    }),
    label: defineMessage({ id: 'installRoot.label', defaultMessage: 'Install location', description: 'Field.' }),
    hint: defineMessage({
        id: 'installRoot.hint',
        defaultMessage:
            'A folder on the host where TRC may run programs, such as ~/.trc or /scratch/you/trc. The next connection uses it.',
        description: 'Field instructions.',
    }),
    invalid: defineMessage({
        id: 'installRoot.invalid',
        defaultMessage: 'Type a path that starts with / or ~/.',
        description: 'Field error with its fix.',
    }),
    save: defineMessage({ id: 'installRoot.save', defaultMessage: 'Save', description: 'Button.' }),
    cancel: defineMessage({ id: 'installRoot.cancel', defaultMessage: 'Cancel', description: 'Button.' }),
};

/** The optional user field of Add host (US-1.1.6). */
export const addHostMessages = {
    user: defineMessage({ id: 'addHost.user', defaultMessage: 'User (optional)', description: 'Field label.' }),
    twoUsers: defineMessage({
        id: 'addHost.twoUsers',
        defaultMessage: 'Give the user either in the host field or here, not both.',
        description: 'Error when the host field has user@ and the user field is filled too.',
    }),
};
