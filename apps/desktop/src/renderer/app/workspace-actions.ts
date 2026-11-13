import type { IntlShape } from 'react-intl';
import { formatChord } from '../../shared/keymap';
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

/** A host's actions: connect, disconnect or cancel, and a new session while it is connected. */
export function hostActions(
    intl: IntlShape,
    workspace: WorkspaceController,
    host: HostEntry,
): readonly WorkspaceAction[] {
    const action = workspace.connectionAction(host);
    const connection: readonly WorkspaceAction[] =
        action === 'review-key'
            ? []
            : [
                  {
                      id: `${host.id}:${action}`,
                      label: intl.formatMessage(connectionActionMessages[action], { host: host.destination }),
                      run: () => workspace.toggleConnection(host.id),
                  },
              ];
    const create: readonly WorkspaceAction[] = isConnected(host)
        ? [
              {
                  id: `${host.id}:new-session`,
                  label: intl.formatMessage(hostSessionsMessages.newSession, { host: host.destination }),
                  run: () => void workspace.newSession(host.id),
              },
          ]
        : [];
    return [...create, ...connection];
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
    const hosts = groups.flatMap((group) => hostActions(intl, workspace, group.host));
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
