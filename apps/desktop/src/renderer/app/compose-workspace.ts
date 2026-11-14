import type { SessionInfo } from '@trc/protocol';
import { createIntl } from 'react-intl';
import type { Settings } from '../../shared/settings';
import type { HostClient } from '../connection/host-client';
import { DEFAULT_LOCALE, messagesFor } from '../i18n/locale';
import {
    terminalDisconnectedMessage,
    terminalLabelMessage,
    terminalMessages,
    terminalReviewMessage,
} from '../sessions/messages';
import { type KnownHostStore, type SessionKey, WorkspaceController } from '../sessions/workspace-controller';
import { sessionName } from '../sessions/workspace-model';
import type { TerminalLink } from '../terminal/hyperlinks';
import type { TerminalNotice } from '../terminal/notices';
import { floodMessage } from '../terminal/output-messages';
import { type SessionSpeech, TerminalRegistry } from '../terminal/terminal-registry';
import type { TerminalPalette } from '../ui/themes';
import type { Announcer } from './announcer';

/** The live workspace: the read model and its controller, and the terminals it shows. */
export interface ComposedWorkspace {
    readonly workspace: WorkspaceController;
    readonly terminals: TerminalRegistry;
}

/** What composing the workspace needs. */
export interface WorkspaceSources {
    readonly client: HostClient;
    readonly isMac: boolean;
    readonly assistiveTechnology: () => boolean;
    readonly palette: TerminalPalette;
    /** Where known hosts are kept (P-18). */
    readonly hosts: KnownHostStore;
    /** Where the open session's output is spoken, and when (A11Y-02). */
    readonly speech: SpeechSources;
    /** The user opened a link in a terminal (US-1.12.3). */
    readonly onOpenLink: (link: TerminalLink) => void;
    /** The user pasted more than one line into a session (US-1.12.2). */
    readonly onPasteRequest: (key: SessionKey, text: string) => void;
    /** A session's terminal reported something to show or announce. */
    readonly onNotice: (key: SessionKey, notice: TerminalNotice) => void;
    /** The user asked for a terminal's context menu (A11Y-11.11). */
    readonly onContextMenu: (canCopy: boolean) => void;
    /** A program wrote the clipboard while its host allowed it (SEC-06.1). */
    readonly onClipboardWrite: (key: SessionKey, text: string) => void;
    /** The settings page's current settings (A11Y-10.3). */
    readonly settings: () => Settings;
}

/** What speaking output needs. */
export interface SpeechSources {
    readonly announcer: Pick<Announcer, 'announce' | 'cancel'>;
    /** Whether screen-reader mode is on (A11Y-10.2). */
    readonly screenReader: () => boolean;
    /** Whether the user muted a session's output (A11Y-02.4). */
    readonly isMuted: (key: SessionKey) => boolean;
}

/** Builds the workspace over a connection-host client, naming each terminal after its session and host. */
export function composeWorkspace(sources: WorkspaceSources): ComposedWorkspace {
    const intl = createIntl({ locale: DEFAULT_LOCALE, messages: messagesFor(DEFAULT_LOCALE) });
    let workspace: WorkspaceController | undefined;
    const destination = (hostId: string): string =>
        workspace?.store.getState().hosts.find((host) => host.id === hostId)?.destination ?? hostId;
    const terminals = new TerminalRegistry({
        transport: sources.client,
        isMac: sources.isMac,
        assistiveTechnology: sources.assistiveTechnology,
        palette: sources.palette,
        labelFor: (hostId: string, session: SessionInfo) => ({
            name: intl.formatMessage(terminalLabelMessage, {
                session: sessionName(session),
                host: destination(hostId),
            }),
            hint: intl.formatMessage(terminalMessages.hint),
            outputBelow: intl.formatMessage(terminalMessages.outputBelow),
            disconnected: intl.formatMessage(terminalDisconnectedMessage, {
                session: sessionName(session),
                host: destination(hostId),
            }),
            inputRefused: intl.formatMessage(terminalMessages.inputRefused),
            inputNotReady: intl.formatMessage(terminalMessages.inputNotReady),
            review: intl.formatMessage(terminalReviewMessage, {
                session: sessionName(session),
                host: destination(hostId),
            }),
        }),
        onActivity: (key) => workspace?.recordActivity(key),
        speech: sessionSpeech(
            sources.speech,
            () => sources.settings().floodThreshold,
            (lines) => intl.formatMessage(floodMessage, { lines }),
        ),
        onOpenLink: sources.onOpenLink,
        onPasteRequest: (key, text) =>
            sources.settings().pasteConfirmation ? sources.onPasteRequest(key, text) : terminals.paste(key, text),
        onNotice: sources.onNotice,
        onContextMenu: sources.onContextMenu,
        clipboardWrites: (hostId) =>
            workspace?.store.getState().hosts.find((host) => host.id === hostId)?.allowClipboardWrites === true,
        onClipboardWrite: sources.onClipboardWrite,
        onAttachFailed: (key, error) => workspace?.attachFailed(key, error),
    });
    workspace = new WorkspaceController(sources.client, terminals, sources.hosts, sources.settings);
    return { workspace, terminals };
}

/** Speaks each session's output through the announcer, one appending group per session (A11Y-02.1). */
function sessionSpeech(
    sources: SpeechSources,
    floodThreshold: () => number,
    summary: (lines: number) => string,
): SessionSpeech {
    const group = (key: SessionKey): string => `output:${key}`;
    return {
        allowed: (key) => sources.screenReader() && !sources.isMuted(key),
        speak: (key, text) => sources.announcer.announce(text, { group: group(key), append: true }),
        cancel: (key) => sources.announcer.cancel(group(key)),
        floodThreshold,
        summary,
    };
}
