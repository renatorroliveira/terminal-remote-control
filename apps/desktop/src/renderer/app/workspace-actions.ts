import type { IntlShape, MessageDescriptor } from 'react-intl';
import { formatChord } from '../../shared/keymap';
import { hostActionMessages } from '../sessions/host-messages';
import { connectionActionMessages, hostSessionsMessages } from '../sessions/messages';
import type { WorkspaceController } from '../sessions/workspace-controller';
import { type HostEntry, hostGroups, isConnected, type SessionItem } from '../sessions/workspace-model';
import type { Shell } from './shell';
import { contextMenuMessages, paletteMessages } from './shell-messages';

/** One thing the user can do, in a context menu or the command palette (A11Y-11.11). */
export interface WorkspaceAction {
    readonly id: string;
    readonly label: string;
    /** The shortcut that runs it, as text, when it has one. */
    readonly shortcut?: string;
    run(): void;
}

/**
 * A host's actions: a new session while it is connected; connect, disconnect or cancel; and, with the shell, test
 * the connection, move the install location and forget the host (US-1.1.5, US-1.4.3, A11Y-11.9).
 */
export function hostActions(
    intl: IntlShape,
    workspace: WorkspaceController,
    host: HostEntry,
    shell?: Shell,
): readonly WorkspaceAction[] {
    const action = workspace.connectionAction(host);
    const named = (id: string, message: MessageDescriptor, run: () => void): WorkspaceAction => ({
        id: `${host.id}:${id}`,
        label: intl.formatMessage(message, { host: host.destination }),
        run,
    });
    const create = isConnected(host)
        ? [named('new-session', hostSessionsMessages.newSession, () => void workspace.newSession(host.id))]
        : [];
    const connection =
        action === 'review-key'
            ? []
            : [named(action, connectionActionMessages[action], () => workspace.toggleConnection(host.id))];
    const managed =
        shell === undefined
            ? []
            : [
                  ...(action === 'connect'
                      ? [named('test', hostActionMessages.test, () => void shell.testConnection(host.id))]
                      : []),
                  named('install-root', hostActionMessages.installRoot, () =>
                      shell.setHostDialog({ kind: 'install-root', hostId: host.id }),
                  ),
                  named('forget', hostActionMessages.forget, () =>
                      shell.setHostDialog({ kind: 'forget', hostId: host.id }),
                  ),
              ];
    return [...create, ...connection, ...managed];
}

/** A session's actions in its context menu; ST-13 adds rename, stop, restart and close. */
export function sessionActions(
    intl: IntlShape,
    workspace: WorkspaceController,
    item: SessionItem,
): readonly WorkspaceAction[] {
    return [
        {
            id: `${item.key}:open`,
            label: intl.formatMessage(contextMenuMessages.open),
            run: () => workspace.open(item.key),
        },
    ];
}

/**
 * Everything the command palette offers (A11Y-11.11): the shell's commands with their shortcuts, every host's
 * actions, and opening each session.
 */
export function paletteActions(
    intl: IntlShape,
    shell: Shell,
    workspace: WorkspaceController,
): readonly WorkspaceAction[] {
    const commands = shell.commands.list().map((command) => {
        const chord = shell.keymap.chordFor(command.id);
        return {
            id: command.id,
            label: command.label,
            ...(chord === undefined ? {} : { shortcut: formatChord(chord) }),
            run: () => command.run(),
        };
    });
    const groups = hostGroups(workspace.store.getState());
    const hosts = workspace.store.getState().hosts.flatMap((host) => hostActions(intl, workspace, host, shell));
    const sessions = groups.flatMap((group) =>
        group.sessions.map((item) => ({
            id: `${item.key}:open`,
            label: intl.formatMessage(paletteMessages.openSession, {
                session: item.label,
                host: group.host.destination,
            }),
            run: () => workspace.open(item.key),
        })),
    );
    return [...commands, ...hosts, ...sessions];
}
