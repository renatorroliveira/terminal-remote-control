import type { SessionInfo } from '@trc/protocol';
import { createIntl } from 'react-intl';
import type { HostClient } from '../connection/host-client';
import { DEFAULT_LOCALE, messagesFor } from '../i18n/locale';
import { terminalLabelMessage, terminalMessages } from '../sessions/messages';
import { WorkspaceController } from '../sessions/workspace-controller';
import { sessionName } from '../sessions/workspace-model';
import { TerminalRegistry } from '../terminal/terminal-registry';
import type { TerminalPalette } from '../ui/themes';

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
        }),
    });
    workspace = new WorkspaceController(sources.client, terminals);
    return { workspace, terminals };
}
