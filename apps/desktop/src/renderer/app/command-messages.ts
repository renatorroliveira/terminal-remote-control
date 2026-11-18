import { defineMessage, defineMessages } from 'react-intl';

/** What command navigation and the open session's finished commands announce (US-5.2). */
export const commandAnnouncements = defineMessages({
    failed: defineMessage<{ code: number }>({
        id: 'announce.commandFailed',
        defaultMessage: 'Command failed, exit code {code}.',
        description: 'A command in the open session ended with a non-zero exit status (US-5.2.2).',
    }),
    moved: defineMessage<{ line: string }>({
        id: 'announce.commandMoved',
        defaultMessage: '{line}',
        description: 'The command line moved to: its prompt and what was typed (US-5.2.1).',
    }),
    movedFailed: defineMessage<{ line: string; code: number }>({
        id: 'announce.commandMovedFailed',
        defaultMessage: '{line}. Failed, exit code {code}.',
        description: 'The command line moved to, which ended with a non-zero exit status.',
    }),
    movedRunning: defineMessage<{ line: string }>({
        id: 'announce.commandMovedRunning',
        defaultMessage: '{line}. Still running.',
        description: 'The command line moved to, which has not ended yet.',
    }),
    firstCommand: {
        id: 'announce.commandFirst',
        defaultMessage: 'No earlier command.',
        description: 'Previous command found none before the current one.',
    },
    lastCommand: {
        id: 'announce.commandLast',
        defaultMessage: 'No later command.',
        description: 'Next command found none after the current one.',
    },
    fullScreen: {
        id: 'announce.commandFullScreen',
        defaultMessage: 'Commands can’t be reached while a full-screen program runs.',
        description: 'Command navigation refused on the alternate screen (US-5.2.3).',
    },
    noCommandYet: {
        id: 'announce.commandNoneYet',
        defaultMessage: 'No command has run in this session yet.',
        description: 'Command navigation found no command, though shell integration is on (US-5.2.3).',
    },
    integrationOff: defineMessage<{ host: string }>({
        id: 'announce.commandIntegrationOff',
        defaultMessage:
            'Moving between commands needs shell integration, which is off for {host}. Turn it on in Settings, under Hosts; it applies when a shell next starts.',
        description: 'Command navigation refused: the user turned shell integration off for the host (US-5.2.3).',
    }),
    integrationUnsupported: defineMessage<{ shell: string }>({
        id: 'announce.commandIntegrationUnsupported',
        defaultMessage:
            'Moving between commands needs shell integration, which bash, zsh and fish have and {shell} doesn’t.',
        description: 'Command navigation refused: the session’s shell has no integration (US-5.2.3).',
    }),
    integrationMissing: {
        id: 'announce.commandIntegrationMissing',
        defaultMessage:
            'Moving between commands needs shell integration, which this session’s shell started without. Restart the session to add it.',
        description: 'Command navigation refused: the shell started before integration existed (US-5.2.3).',
    },
    output: defineMessage<{ text: string }>({
        id: 'announce.commandOutput',
        defaultMessage: '{text}',
        description: 'The last command’s output, read aloud (US-5.2.1).',
    }),
    outputTail: defineMessage<{ shown: number; lines: number; text: string }>({
        id: 'announce.commandOutputTail',
        defaultMessage: 'Last {shown} of {lines} lines: {text}',
        description: 'The end of a long output, read aloud; select or copy it for all of it.',
    }),
    outputEmpty: {
        id: 'announce.commandOutputEmpty',
        defaultMessage: 'The last command printed nothing.',
        description: 'Reading, selecting or copying the last command’s output found none.',
    },
    selected: defineMessage<{ lines: number }>({
        id: 'announce.commandOutputSelected',
        defaultMessage: 'Selected the last command’s output, {lines, plural, one {# line} other {# lines}}.',
        description: 'Select last command output selected it.',
    }),
    copyFailed: {
        id: 'announce.commandOutputCopyFailed',
        defaultMessage: 'The last command’s output couldn’t be copied.',
        description: 'Copy last command output failed to write the clipboard.',
    },
    copied: defineMessage<{ lines: number }>({
        id: 'announce.commandOutputCopied',
        defaultMessage: 'Copied the last command’s output, {lines, plural, one {# line} other {# lines}}.',
        description: 'Copy last command output put it on the clipboard.',
    }),
});
